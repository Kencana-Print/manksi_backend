const db = require("../../config/database");
const tutupBukuService = require("../tutupBukuService");

// --- GENERATE NOMOR SJ ---
// Format: PSJ.YYYY.00001
const getNextNomor = async (tanggal) => {
  const year = new Date(tanggal).getFullYear();
  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(poisj_nomor, 5) AS UNSIGNED)), 0) AS max_val 
    FROM tpointernalmapsj_hdr 
    WHERE MID(poisj_nomor, 5, 4) = ?
  `;
  const [rows] = await db.query(query, [year]);
  const nextVal = rows[0].max_val + 1;
  return `PSJ.${year}.${String(nextVal).padStart(5, "0")}`;
};

// --- GET QTY SUDAH KIRIM (Di SJ Lain) ---
const getQtySudahKirim = async (nomorPo, kodeMap, currentSjNomor) => {
  const query = `
    SELECT IFNULL(SUM(d.poisjd_jumlah), 0) AS jml
    FROM tpointernalmapsj_dtl d 
    WHERE d.poisjd_nomor <> ? AND d.poisjd_po = ? AND d.poisjd_kode = ?
  `;
  const [rows] = await db.query(query, [
    currentSjNomor || "",
    nomorPo,
    kodeMap,
  ]);
  return rows[0].jml;
};

// --- LOAD DATA PO (Untuk mengisi Grid SJ) ---
const loadPoItems = async (nomorPo, currentSjNomor) => {
  const query = `
    SELECT 
      d.poid_nomor AS Nomor_PO, 
      d.poid_kode AS Kode_MAP,
      m.mspk_nama AS Nama_MAP, 
      m.Mspk_kain AS Bahan, 
      m.Mspk_ukuran AS Ukuran, 
      m.mspk_jumlah AS Qty_MAP,
      d.poid_jumlah AS Qty_PO,
      IFNULL((SELECT COUNT(k.mspk_nomor) FROM tkesesuaianmap k WHERE k.mspk_nomor = d.poid_kode), 0) AS Bast_Count
    FROM tpointernalmap_dtl d
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.poid_kode
    WHERE d.poid_nomor = ?
    ORDER BY d.poid_nourut
  `;
  const [rows] = await db.query(query, [nomorPo]);

  if (rows.length === 0) throw new Error("Nomor PO tersebut tidak ditemukan.");

  // Hitung sisa qty per item
  const items = [];
  for (const row of rows) {
    const sudahSj = await getQtySudahKirim(
      nomorPo,
      row.Kode_MAP,
      currentSjNomor,
    );
    items.push({
      ...row,
      Has_Bast: row.Bast_Count > 0,
      Sudah_SJ: sudahSj,
      Sisa_PO: row.Qty_PO - sudahSj,
    });
  }
  return items;
};

// --- GET BY ID (Mode Edit) ---
const getById = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT h.*, c.pab_nama AS namacab, u.pab_nama AS tujuan
     FROM tpointernalmapsj_hdr h
     LEFT JOIN tpabrik c ON c.pab_kode = h.poisj_cab
     LEFT JOIN tpabrik u ON u.pab_kode = h.poisj_tujuan
     WHERE h.poisj_nomor = ?`,
    [nomor],
  );

  if (headerRows.length === 0) return null;
  const header = headerRows[0];

  if (header.poisj_approve === "Y")
    throw new Error("SJ ini sudah diApprove. Tidak bisa diedit.");

  const [detailRows] = await db.query(
    `SELECT d.*, m.mspk_nama, m.Mspk_kain, m.Mspk_ukuran, m.mspk_jumlah,
     IFNULL((SELECT COUNT(k.mspk_nomor) FROM tkesesuaianmap k WHERE k.mspk_nomor = d.poisjd_kode), 0) AS Bast_Count
     FROM tpointernalmapsj_dtl d
     LEFT JOIN tmemospk m ON m.mspk_nomor = d.poisjd_kode
     WHERE d.poisjd_nomor = ?`,
    [nomor],
  );

  const detail = [];
  for (const d of detailRows) {
    // Ambil Qty PO asli
    const [poRow] = await db.query(
      `SELECT poid_jumlah FROM tpointernalmap_dtl WHERE poid_nomor=? AND poid_kode=?`,
      [d.poisjd_po, d.poisjd_kode],
    );
    const qtyPo = poRow.length > 0 ? poRow[0].poid_jumlah : 0;
    const sudahSj = await getQtySudahKirim(d.poisjd_po, d.poisjd_kode, nomor);

    detail.push({
      ...d,
      mspk_jumlah: d.mspk_jumlah,
      qty_po: qtyPo,
      sudah_sj: sudahSj,
      kurang: qtyPo - sudahSj,
      has_bast: d.Bast_Count > 0,
    });
  }

  return { header, detail };
};

// --- SAVE ---
const save = async (data, userKode, isNewMode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let nomorSJ = data.Nomor;

    // 1. Validasi Tutup Buku & PIN 5
    const zdtClose =
      await tutupBukuService.getTanggalTutupBuku("SJ POINTERNAL MAP");
    const tglSj = new Date(data.Tanggal);

    // Logic Delphi: Jika di luar periode dan tidak ada ACC PIN 5, blokir.
    if (zdtClose && tglSj < zdtClose && data.StatusEdit !== "ACC") {
      throw new Error(
        "Anda tidak boleh input di tanggal periode yang sudah diclose.",
      );
    }

    if (isNewMode) {
      nomorSJ = await getNextNomor(data.Tanggal);
      await conn.query(
        `INSERT INTO tpointernalmapsj_hdr (poisj_nomor, poisj_tanggal, poisj_cab, poisj_tujuan, date_create, user_create)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [nomorSJ, data.Tanggal, data.GudangAsal, data.Tujuan, userKode],
      );
    } else {
      await conn.query(
        `UPDATE tpointernalmapsj_hdr SET poisj_tanggal=?, poisj_tujuan=?, date_modified=NOW(), user_modified=?
         WHERE poisj_nomor=?`,
        [data.Tanggal, data.Tujuan, userKode, nomorSJ],
      );
    }

    // 2. Simpan Detail
    await conn.query(
      `DELETE FROM tpointernalmapsj_dtl WHERE poisjd_nomor = ?`,
      [nomorSJ],
    );
    for (const d of data.Details) {
      if (d.KodeMAP && Number(d.JumlahSJ) > 0) {
        await conn.query(
          `INSERT INTO tpointernalmapsj_dtl (poisjd_nomor, poisjd_po, poisjd_kode, poisjd_jumlah, poisjd_koli, poisjd_ket)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            nomorSJ,
            d.NomorPO,
            d.KodeMAP,
            d.JumlahSJ,
            d.Koli || 0,
            d.Keterangan || "",
          ],
        );
      }
    }

    // 3. Matikan PIN jika digunakan
    if (data.StatusEdit === "ACC") {
      await conn.query(
        `UPDATE tspk_pin5 SET pin_dipakai="Y" WHERE pin_trs="SJ POINTERNAL MAP" AND pin_nomor=? AND pin_dipakai=""`,
        [nomorSJ],
      );
    }

    await conn.commit();
    return nomorSJ;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      h.poisj_nomor AS Nomor, 
      DATE_FORMAT(h.poisj_tanggal, '%d-%m-%Y') AS Tanggal, 
      c.pab_nama AS GudangAsal, 
      u.pab_nama AS Tujuan,
      h.user_create AS User,
      d.poisjd_kode AS MAP,
      m.mspk_nama AS Nama_MAP,
      m.Mspk_kain AS Bahan,
      m.Mspk_ukuran AS Ukuran,
      d.poisjd_jumlah AS Jumlah,
      d.poisjd_koli AS Koli,
      d.poisjd_ket AS Keterangan
    FROM tpointernalmapsj_hdr h
    INNER JOIN tpointernalmapsj_dtl d ON d.poisjd_nomor = h.poisj_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.poisjd_kode
    LEFT JOIN tpabrik c ON c.pab_kode = h.poisj_cab
    LEFT JOIN tpabrik u ON u.pab_kode = h.poisj_tujuan
    WHERE h.poisj_nomor = ?
    ORDER BY d.poisjd_kode
  `;
  const [rows] = await db.query(query, [nomor]);
  if (rows.length === 0) return null;

  return {
    header: {
      Nomor: rows[0].Nomor,
      Tanggal: rows[0].Tanggal,
      GudangAsal: rows[0].GudangAsal,
      Tujuan: rows[0].Tujuan,
      User: rows[0].User,
    },
    details: rows,
  };
};

module.exports = { getNextNomor, loadPoItems, getById, save, getPrintData };
