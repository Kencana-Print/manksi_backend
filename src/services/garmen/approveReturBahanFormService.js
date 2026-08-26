const db = require("../../config/database");
const tutupBukuService = require("../../services/tutupBukuService");

/**
 * Generate Nomor Otomatis RETP
 */
const generateNomorRETP = async (tahun, conn) => {
  const query = `
    SELECT IFNULL(MAX(CAST(SUBSTRING(proret_nomor, 6, 5) AS UNSIGNED)), 0) AS max_num 
    FROM tproduksiretur_hdr 
    WHERE LEFT(proret_nomor, 4) = 'RETP' AND RIGHT(proret_nomor, 4) = ?
  `;
  const [rows] = await conn.query(query, [tahun]);
  const nextNum = parseInt(rows[0].max_num, 10) + 1;
  return `RETP/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

/**
 * Get Last Barcode Sequence (Sesuai fungsi getLast di Delphi)
 */
const getLastBarcodeSeq = async (kodeBahan) => {
  const query = `SELECT IFNULL(MAX(CAST(RIGHT(bard_barcode, 5) AS UNSIGNED)), 0) AS last_seq FROM tbahan_barcode_dtl WHERE bard_kode = ?`;
  const [rows] = await db.query(query, [kodeBahan]);
  return parseInt(rows[0].last_seq, 10);
};

/**
 * Mengambil Detail Data (Load Data Baru / Edit)
 */
const getDetailApprove = async (nomor) => {
  const isRETL = nomor.startsWith("RETL");
  const hdrTable = isRETL ? "tproduksireturlog_hdr" : "tproduksiretur_hdr";
  const dtlTable = isRETL ? "tproduksireturlog_dtl" : "tproduksiretur_dtl";

  // 1. Ambil Header
  const qHdr = `
    SELECT h.*, g.gdg_nama, p.gdgp_nama 
    FROM ${hdrTable} h
    LEFT JOIN tgudang g ON g.gdg_kode = h.proret_gdg_tujuan
    LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.proret_gdg_produksi
    WHERE h.proret_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data transaksi tidak ditemukan.");
  const header = hdrRows[0];

  // 2. Ambil Detail
  const qDtl = `
    SELECT 
      d.proretd_nominta AS nominta, d.proretd_bhn_kode AS kode, 
      b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
      d.proretd_Jumlah AS jumlah, IF(d.proretd_roll = 0, 1, d.proretd_roll) AS roll, 
      d.proretd_keterangan AS ket, d.proretd_spk AS spk, 
      d.proretd_sup_kode AS kdsup, IFNULL(u.Sup_nama, "") AS nmsup,
      -- PERBAIKAN DI BARIS BAWAH INI:
      IFNULL((SELECT SUM(promind_jumlah) FROM tproduksiminta_dtl WHERE promind_promin_Nomor = d.proretd_nominta AND promind_bhn_kode = d.proretd_bhn_kode), 0) AS minta,
      IFNULL((SELECT SUM(proretd_jumlah) FROM tproduksireturlog_dtl WHERE proretd_nominta = d.proretd_nominta AND proretd_bhn_kode = d.proretd_bhn_kode AND proretd_proret_Nomor <> ?), 0) AS sudah
    FROM ${dtlTable} d
    LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
    LEFT JOIN tsupplier u ON u.Sup_kode = d.proretd_sup_kode
    WHERE d.proretd_proret_Nomor = ?
    ORDER BY d.proretd_bhn_kode, d.proretd_nourut
  `;
  const [dtlRows] = await db.query(qDtl, [nomor, nomor]);

  // 3. Siapkan Array Barcode
  let barcodes = [];

  if (isRETL) {
    // GENERATE PREVIEW BARCODE (Logika dari prosedur loaddataall)
    const tgl = new Date(header.proret_tanggal);
    const yy = String(tgl.getFullYear()).slice(-2); // Ambil 2 digit tahun

    let ckode = "";
    let i = 0;
    let j = 0;
    let r = 0; // ID untuk maping detail atas dan bawah

    for (const d of dtlRows) {
      r++;
      d.no = r;
      d.last = await getLastBarcodeSeq(d.kode);

      if (ckode !== d.kode) {
        i = d.last + 1;
        j = d.last + parseInt(d.roll);
      } else {
        i = j + 1;
        j = j + parseInt(d.roll);
      }

      while (i <= j) {
        barcodes.push({
          no: i,
          id: d.no, // Referensi ke baris detail atas
          kode: d.kode,
          nama: d.nama,
          barcode: `${d.kode}-${yy}${String(i).padStart(4, "0")}`, // Format: KODE-YY0001
          jumlah: parseInt(d.roll) === 1 ? parseFloat(d.jumlah) : 0, // Jika >1 roll, jumlah diset 0 untuk diisi manual oleh user
        });
        i++;
      }
      ckode = d.kode;
    }
  } else {
    // LOAD EXISTING BARCODE (Logika dari prosedur loadApprove)
    let r = 0;
    for (const d of dtlRows) {
      r++;
      d.no = r;
      d.rollx = d.roll; // Simpan nilai asli
    }

    const qBarcode = `
      SELECT bard_id AS id, bard_kode AS kode, bard_barcode AS barcode, 
             b.Bhn_Name AS nama, bard_jumlah AS jumlah
      FROM tbahan_barcode_dtl d
      LEFT JOIN tbahan b ON b.Bhn_kode = d.bard_kode
      WHERE d.bard_nomor = ? 
      ORDER BY d.bard_barcode
    `;
    const [bcRows] = await db.query(qBarcode, [nomor]);
    barcodes = bcRows.map((b) => ({
      no: b.id, // Sesuai Delphi
      id: b.id,
      kode: b.kode,
      nama: b.nama,
      barcode: b.barcode,
      jumlah: b.jumlah,
    }));
  }

  return { header, details: dtlRows, barcodes };
};

/**
 * Simpan Data Approve (RETP & Barcode)
 */
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor; // Jika baru dari RETL, isinya RETL/xxx. Jika edit, isinya RETP/xxx.
    const isEdit = nomor.startsWith("RETP");
    const noReturLog = isEdit ? payload.proret_log : nomor; // Menyimpan histori nomor log
    const now = new Date();
    const dateModified =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0") +
      ":" +
      String(now.getSeconds()).padStart(2, "0");

    // 1. Validasi Tutup Buku
    const tglTrs = new Date(payload.tanggal);
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose) {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // 2. Simpan Header
    if (isEdit) {
      await conn.query(
        `UPDATE tproduksiretur_hdr SET 
          proret_tanggal=?, proret_gdg_tujuan=?, proret_gdg_produksi=?, proret_keterangan=?, date_modified=?, user_modified=? 
         WHERE proret_nomor=?`,
        [
          payload.tanggal,
          payload.gudangAsal,
          payload.gudangProduksi,
          payload.keterangan || "",
          dateModified,
          user.kode,
          nomor,
        ],
      );
    } else {
      const tahun = payload.tanggal.substring(0, 4);
      nomor = await generateNomorRETP(tahun, conn); // Override nomor menjadi RETP

      await conn.query(
        `INSERT INTO tproduksiretur_hdr (proret_nomor, proret_log, proret_tanggal, proret_gdg_tujuan, proret_gdg_produksi, proret_keterangan, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          noReturLog,
          payload.tanggal,
          payload.gudangAsal,
          payload.gudangProduksi,
          payload.keterangan || "",
          dateModified,
          user.kode,
        ],
      );
    }

    // 3. Simpan Detail Bahan
    await conn.query(
      `DELETE FROM tproduksiretur_dtl WHERE proretd_proret_nomor=?`,
      [nomor],
    );

    if (payload.details && payload.details.length > 0) {
      const detailValues = [];
      let noUrut = 1;
      for (const d of payload.details) {
        if (!d.nama) continue;
        detailValues.push([
          nomor,
          d.kode,
          parseFloat(d.jumlah),
          parseInt(d.roll) || 1,
          d.ket || "",
          d.kdsup || "",
          d.nominta || "",
          d.spk || "",
          noUrut,
        ]);
        noUrut++;
      }
      if (detailValues.length > 0) {
        await conn.query(
          `INSERT INTO tproduksiretur_dtl (proretd_proret_nomor, proretd_bhn_kode, proretd_jumlah, proretd_roll, proretd_keterangan, proretd_sup_kode, proretd_nominta, proretd_spk, proretd_nourut) VALUES ?`,
          [detailValues],
        );
      }
    }

    // 4. Simpan Data Barcode
    await conn.query(`DELETE FROM tbahan_barcode_dtl WHERE bard_nomor=?`, [
      nomor,
    ]);

    if (payload.barcodes && payload.barcodes.length > 0) {
      const barcodeValues = [];
      let urutBc = 1;
      for (const b of payload.barcodes) {
        if (!b.nama) continue;
        barcodeValues.push([
          nomor,
          b.kode,
          b.barcode,
          parseFloat(b.jumlah || 0),
          b.id,
          urutBc,
        ]);
        urutBc++;
      }
      if (barcodeValues.length > 0) {
        await conn.query(
          `INSERT INTO tbahan_barcode_dtl (bard_nomor, bard_kode, bard_barcode, bard_jumlah, bard_id, bard_nourut) VALUES ?`,
          [barcodeValues],
        );
      }
    }

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getDetailApprove,
  saveData,
};
