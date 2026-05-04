const db = require("../../config/database");
const tutupBukuService = require("../../services/tutupBukuService");

/**
 * Generate Nomor Otomatis (RETP / RETL)
 */
const generateNomor = async (prefix, tahun, conn) => {
  const table =
    prefix === "RETP" ? "tproduksiretur_hdr" : "tproduksireturlog_hdr";
  const query = `
    SELECT IFNULL(MAX(CAST(SUBSTRING(proret_nomor, 6, 5) AS UNSIGNED)), 0) AS max_num 
    FROM ${table} 
    WHERE LEFT(proret_nomor, 4) = ? AND RIGHT(proret_nomor, 4) = ?
  `;
  const [rows] = await conn.query(query, [prefix, tahun]);
  const nextNum = parseInt(rows[0].max_num, 10) + 1;
  return `${prefix}/${String(nextNum).padStart(5, "0")}/${tahun}`;
};

/**
 * Get Dropdown Gudang Bahan
 */
const getGudangBahan = async () => {
  const [rows] = await db.query(
    `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_bahan = 4 AND gdg_status = 1 ORDER BY gdg_nama`,
  );
  return rows;
};

/**
 * Get Dropdown Gudang Produksi
 */
const getGudangProduksi = async (cabang) => {
  let filter = `gdgp_jasa="POTONG"`;
  if (cabang === "P01") filter = `gdgp_kode="GP015"`;
  else if (cabang === "P04") filter = `gdgp_kode="GP001"`;

  const [rows] = await db.query(
    `SELECT gdgp_kode AS kode, gdgp_nama AS nama FROM tgudangproduksi WHERE gdgp_aktif = 0 AND ${filter} ORDER BY gdgp_nama`,
  );
  return rows;
};

/**
 * Pencarian Detail dari Nomor Realisasi Minta (Replikasi fungsi F1kode di Delphi)
 */
const getDetailRealisasi = async (noMinta, gudangProduksi) => {
  const query = `
    SELECT 
      h.promin_nomor AS nominta, h.promin_spk_nomor AS spk,
      d.promind_bhn_kode AS kode, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
      d.promind_jumlah AS minta,
      d.promind_sup_kode AS kdsup, IFNULL(u.Sup_nama, "") AS nmsup,
      (SELECT IFNULL(SUM(u.proretd_Jumlah),0) FROM tproduksireturlog_dtl u WHERE u.proretd_nominta = h.promin_nomor AND u.proretd_bhn_kode = d.promind_bhn_kode) AS sudah,
      (SELECT IFNULL(SUM(k.mph_qty_berat),0) FROM tmutasiproduksi_hdr k WHERE k.mph_nomaterial = h.promin_nomor AND k.mph_spk_nomor = h.promin_spk_nomor AND k.mph_gdgasal = ?) AS lhk
    FROM tproduksiminta_hdr h
    INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
    LEFT JOIN tsupplier u ON u.Sup_kode = d.promind_sup_kode
    WHERE h.promin_nomor = ?
  `;
  const [rows] = await db.query(query, [gudangProduksi, noMinta]);
  return rows;
};

/**
 * Load Detail untuk Mode Edit
 */
const getEditDetail = async (nomor) => {
  const isRETP = nomor.startsWith("RETP");
  const hdrTable = isRETP ? "tproduksiretur_hdr" : "tproduksireturlog_hdr";
  const dtlTable = isRETP ? "tproduksiretur_dtl" : "tproduksireturlog_dtl";
  const dtlFields = isRETP
    ? `"" AS nominta, d.proretd_bhn_kode AS kode`
    : `d.proretd_nominta AS nominta, d.proretd_bhn_kode AS kode`;

  const qHdr = `
    SELECT h.*, g.gdg_nama, p.gdgp_nama,
    (SELECT pin_dipakai FROM tspk_pin5 WHERE pin_trs="RETUR BAHAN" AND pin_nomor=h.proret_nomor ORDER BY pin_urut DESC LIMIT 1) AS pin_dipakai,
    (SELECT pin_acc FROM tspk_pin5 WHERE pin_trs="RETUR BAHAN" AND pin_nomor=h.proret_nomor ORDER BY pin_urut DESC LIMIT 1) AS pin_acc
    FROM ${hdrTable} h
    LEFT JOIN tgudang g ON g.gdg_kode = h.proret_gdg_tujuan
    LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.proret_gdg_produksi
    WHERE h.proret_nomor = ?
  `;
  const [hdrRows] = await db.query(qHdr, [nomor]);
  if (hdrRows.length === 0) throw new Error("Data tidak ditemukan.");

  const qDtl = `
    SELECT 
      ${dtlFields}, b.Bhn_Name AS nama, b.Bhn_satuan AS satuan,
      d.proretd_Jumlah AS jumlah, d.proretd_roll AS roll, d.proretd_keterangan AS ket,
      d.proretd_spk AS spk, d.proretd_sup_kode AS kdsup, IFNULL(u.Sup_nama, "") AS nmsup,
      -- Tambahan logic Delphi: Ambil data pembanding real-time
      IFNULL((SELECT promind_jumlah FROM tproduksiminta_dtl WHERE promind_promin_Nomor = d.proretd_nominta AND promind_bhn_kode = d.proretd_bhn_kode), 0) AS minta,
      IFNULL((SELECT SUM(proretd_Jumlah) FROM tproduksireturlog_dtl WHERE proretd_proret_Nomor <> d.proretd_proret_Nomor AND proretd_nominta = d.proretd_nominta AND proretd_bhn_kode = d.proretd_bhn_kode), 0) AS sudah
    FROM ${dtlTable} d
    LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
    LEFT JOIN tsupplier u ON u.Sup_kode = d.proretd_sup_kode
    WHERE d.proretd_proret_Nomor = ?
    ORDER BY d.proretd_nourut
  `;
  const [dtlRows] = await db.query(qDtl, [nomor]);

  return { header: hdrRows[0], details: dtlRows };
};

/**
 * Save Data (Baru & Ubah)
 */
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let nomor = payload.nomor;
    const isEdit = !!nomor;
    const isUserGudang = user.bagian.toUpperCase() === "GUDANG";

    // Penentuan jenis RETUR berdasarkan rule Delphi (Jika Gudang = RETP, Produksi = RETL)
    const isRETP = isEdit ? nomor.startsWith("RETP") : isUserGudang;
    // --- TAMBAHKAN VALIDASI DI SINI ---
    if (!isEdit && isRETP && user.bagian.toUpperCase() !== "GUDANG") {
      throw new Error(
        "Anda tidak memiliki otoritas untuk membuat Retur Gudang (RETP).",
      );
    }
    // ----------------------------------
    const prefix = isRETP ? "RETP" : "RETL";
    const hdrTable = isRETP ? "tproduksiretur_hdr" : "tproduksireturlog_hdr";
    const dtlTable = isRETP ? "tproduksiretur_dtl" : "tproduksireturlog_dtl";
    const tglTrs = new Date(payload.tanggal);
    const dateModified = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    // 1. VALIDASI TUTUP BUKU
    const zdtClose = await tutupBukuService.getTanggalTutupBuku();
    if (tglTrs <= zdtClose && payload.pin_acc !== "Y") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yg sudah diclose.",
      );
    }

    // 2. SIMPAN HEADER
    if (isEdit) {
      await conn.query(
        `UPDATE ${hdrTable} SET 
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

      // Update PIN5 jika ACC
      if (payload.pin_acc === "Y" && !payload.pin_dipakai) {
        await conn.query(
          `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="RETUR BAHAN" AND pin_nomor=? AND pin_dipakai=""`,
          [nomor],
        );
      }
    } else {
      const tahun = payload.tanggal.substring(0, 4);
      nomor = await generateNomor(prefix, tahun, conn);

      await conn.query(
        `INSERT INTO ${hdrTable} (proret_nomor, proret_tanggal, proret_gdg_tujuan, proret_gdg_produksi, proret_keterangan, date_create, user_create)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          payload.tanggal,
          payload.gudangAsal,
          payload.gudangProduksi,
          payload.keterangan || "",
          dateModified,
          user.kode,
        ],
      );
    }

    // 3. SIMPAN DETAIL
    await conn.query(`DELETE FROM ${dtlTable} WHERE proretd_proret_nomor=?`, [
      nomor,
    ]);

    if (payload.details && payload.details.length > 0) {
      const detailValues = [];
      let noUrut = 1;

      for (const d of payload.details) {
        if (!d.nama) continue;
        if (!d.jumlah || parseFloat(d.jumlah) <= 0)
          throw new Error(`Jumlah untuk barang ${d.nama} harus di isi!`);

        // Sesuai Delphi: RETP tidak menyimpan nominta di tabel detailnya.
        if (isRETP) {
          detailValues.push([
            nomor,
            d.kode,
            parseFloat(d.jumlah),
            parseInt(d.roll) || 1,
            d.ket || "",
            d.kdsup || "",
            d.spk || "",
            noUrut,
          ]);
        } else {
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
        }
        noUrut++;
      }

      if (detailValues.length > 0) {
        const qInsertDtl = isRETP
          ? `INSERT INTO tproduksiretur_dtl (proretd_proret_nomor, proretd_bhn_kode, proretd_jumlah, proretd_roll, proretd_keterangan, proretd_sup_kode, proretd_spk, proretd_nourut) VALUES ?`
          : `INSERT INTO tproduksireturlog_dtl (proretd_proret_nomor, proretd_bhn_kode, proretd_jumlah, proretd_roll, proretd_keterangan, proretd_sup_kode, proretd_nominta, proretd_spk, proretd_nourut) VALUES ?`;

        await conn.query(qInsertDtl, [detailValues]);
      } else {
        throw new Error("Detail tidak boleh kosong.");
      }
    } else {
      throw new Error("Detail tidak boleh kosong.");
    }

    // 4. UPDATE PIN OTORISASI (Sesuai logic: if xminta5='ACC' then update pin_dipakai="Y")
    if (payload.pin_acc === "Y" && !payload.pin_dipakai) {
      // Sesuai Delphi: update berdasarkan nomor dan urut
      await conn.query(
        `UPDATE tspk_pin5 
     SET pin_dipakai="Y" 
     WHERE pin_trs="RETUR BAHAN" AND pin_nomor=? AND pin_acc="Y" AND pin_dipakai="" 
     ORDER BY pin_urut DESC LIMIT 1`,
        [nomor],
      );
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

const getPrintData = async (nomor) => {
  const isRETP = nomor.startsWith("RETP");
  const hdrTable = isRETP ? "tproduksiretur_hdr" : "tproduksireturlog_hdr";
  const dtlTable = isRETP ? "tproduksiretur_dtl" : "tproduksireturlog_dtl";

  // Replikasi logic Delphi: RIGHT(p.gdgp_nama, length(p.gdgp_nama)-3)
  const query = `
    SELECT 
      h.proret_nomor, 
      DATE_FORMAT(h.proret_tanggal, '%d %b %Y') as proret_tanggal,
      g.gdg_nama as tujuan, 
      SUBSTRING(p.gdgp_nama, 4) as dari, 
      h.proret_keterangan,
      d.proretd_bhn_kode as kode,
      b.Bhn_Name as nama, 
      b.Bhn_satuan as satuan,
      d.proretd_Jumlah as jumlah,
      ${isRETP ? "d.proretd_spk" : 'CONCAT(d.proretd_nominta, " ", d.proretd_spk)'} as referensi,
      d.proretd_keterangan as ket_detail,
      u.Sup_nama as supplier
    FROM ${hdrTable} h
    INNER JOIN ${dtlTable} d ON d.proretd_proret_Nomor = h.proret_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.proretd_bhn_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.proret_gdg_tujuan
    LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.proret_gdg_produksi
    LEFT JOIN tsupplier u ON u.Sup_kode = d.proretd_sup_kode
    WHERE h.proret_nomor = ?
    ORDER BY d.proretd_nourut
  `;

  const [rows] = await db.query(query, [nomor]);
  return rows;
};

module.exports = {
  getGudangBahan,
  getGudangProduksi,
  getDetailRealisasi,
  getEditDetail,
  saveData,
  getPrintData,
};
