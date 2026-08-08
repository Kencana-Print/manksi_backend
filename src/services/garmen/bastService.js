const db = require("../../config/database");

// --- GET BROWSE LIST ---
const getBrowseList = async (filters, userCabang) => {
  const { startDate, endDate, onProgressOnly } = filters;

  let params = [];
  let whereClause = `WHERE m.mspk_divisi IN (3, 4, 6) AND m.mspk_cmo <> ""`;

  // Filter khusus "On Progress" (ckLock di Delphi)
  if (onProgressOnly === "true" || onProgressOnly === true) {
    whereClause += ` AND m.mspk_nomor IN (SELECT map FROM tkesesuaianmap_lock WHERE apv = "N"`;
    if (userCabang && userCabang !== "ALL" && userCabang !== "HO-") {
      whereClause += ` AND cab = ?`;
      params.push(userCabang);
    }
    whereClause += `)`;
  } else {
    // Jika tidak On Progress, gunakan filter tanggal mspk_tanggal
    whereClause += ` AND m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?`;
    params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
  }

  const query = `
    SELECT 
      m.mspk_nomor AS Nomor,
      IF(m.mspk_divisi = 3, "KAOSAN", "GARMEN") AS Divisi,
      m.mspk_tipe AS Tipe,
      m.mspk_tanggal AS Tanggal,
      IF((SELECT s.mspk_nomor FROM tkesesuaianmap s WHERE s.mspk_nomor = m.mspk_nomor LIMIT 1) IS NULL, "", "SUDAH") AS CetakBAST,
      m.mspk_nama AS NamaPekerjaan,
      m.mspk_nama2 AS NamaExt,
      m.mspk_ukuran AS Ukuran,
      m.mspk_gramasi AS Gramasi,
      IFNULL((SELECT k.keterangan FROM tkesesuaianmap k WHERE k.kode_sesuai = 2 AND k.mspk_nomor = m.mspk_nomor LIMIT 1), "") AS GramasiSetting_Aktual,
      m.mspk_kain AS Kain,
      m.mspk_finishing AS Finishing,
      m.mspk_keterangan AS Keterangan,
      m.mspk_kendala AS kendalaProduksi,
      m.mspk_jumlah_jadi AS Jumlah,
      (SELECT IFNULL(l.apv, "") FROM tkesesuaianmap_lock l WHERE l.map = m.mspk_nomor LIMIT 1) AS OnProgres
    FROM tmemospk m
    ${whereClause}
    ORDER BY m.mspk_tanggal DESC
  `;

  const [rows] = await db.query(query, params);
  return rows;
};

// --- DELETE BAST ---
const deleteBast = async (nomor, userKode) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Hapus dari tabel utama BAST
    await conn.query(`DELETE FROM tkesesuaianmap WHERE mspk_nomor = ?`, [
      nomor,
    ]);

    // 2. Reset data di tmemospk (Sesuai logic Delphi)
    await conn.query(
      `UPDATE tmemospk SET mspk_jumlah_jadi = 0, mspk_kendala = "", mspk_tipe = NULL WHERE mspk_nomor = ?`,
      [nomor],
    );

    // 3. Hapus tabel-tabel pendukung terkait BAST
    await conn.query(`DELETE FROM tkesesuaianmap_komponen WHERE nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tkesesuaianmap_obat WHERE ko_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tkesesuaianmap_lock WHERE map = ?`, [nomor]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- GET EXPORT DETAIL ---
const getExportDetail = async (filters, userCabang) => {
  // 1. Ambil data master/header dengan filter yang sama persis
  const headers = await getBrowseList(filters, userCabang);
  if (headers.length === 0) return [];

  const mapNomors = headers.map((h) => h.Nomor);
  const placeholders = mapNomors.map(() => "?").join(",");

  // 2. Ambil data Komponen (Bahan)
  // Sesuai struktur: menggunakan c.nomor, c.kode, dan c.babaran
  const [komponen] = await db.query(
    `
    SELECT 
      c.nomor AS Nomor, 
      c.kode AS Kode, 
      b.bhn_name AS Nama, 
      c.babaran AS Qty, 
      b.bhn_satuan AS Satuan, 
      'KOMPONEN' AS Jenis
    FROM tkesesuaianmap_komponen c
    LEFT JOIN tbahan b ON b.bhn_kode = c.kode
    WHERE c.nomor IN (${placeholders})
  `,
    mapNomors,
  );

  // 3. Ambil data Obat
  // Sesuai struktur: menggunakan o.ko_nomor, o.ko_kode, dan o.ko_qty
  const [obat] = await db.query(
    `
    SELECT 
      o.ko_nomor AS Nomor, 
      o.ko_kode AS Kode, 
      b.bhn_name AS Nama, 
      o.ko_qty AS Qty, 
      b.bhn_satuan AS Satuan, 
      'OBAT' AS Jenis
    FROM tkesesuaianmap_obat o
    LEFT JOIN tbahan b ON b.bhn_kode = o.ko_kode
    WHERE o.ko_nomor IN (${placeholders})
  `,
    mapNomors,
  );

  const allDetails = [...komponen, ...obat];

  // 4. Gabungkan ke dalam objek headers
  return headers.map((h) => ({
    ...h,
    details: allDetails.filter((d) => d.Nomor === h.Nomor),
  }));
};

module.exports = {
  getBrowseList,
  deleteBast,
  getExportDetail,
};
