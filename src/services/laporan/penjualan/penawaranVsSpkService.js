const db = require("../../../config/database");

// --- 1. GET BROWSE HEADER (Master Penawaran) ---
const getBrowse = async (query, canLihatCus = false) => {
  const { startDate, endDate, divisi } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const custCol = canLihatCus
    ? "c.cus_nama AS NamaCustomer,"
    : `"" AS NamaCustomer,`;

  let sql = `
    SELECT 
      h.pen_nomor AS Nomor,
      h.pen_tanggal AS Tanggal,
      v.Divisi AS Divisi,
      ${custCol}
      h.pen_keterangan AS Keterangan,
      IFNULL((
        SELECT COUNT(s.spk_pen_nomor) 
        FROM tspk s 
        WHERE s.spk_pen_nomor = h.pen_nomor AND s.spk_aktif = 'Y'
      ), 0) AS TotalSPK
    FROM tpenawaran_hdr h
    INNER JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode
    LEFT JOIN tdivisi v ON v.kode = h.pen_divisi
    WHERE h.pen_tanggal >= ? AND h.pen_tanggal <= ?
  `;

  const params = [dStart, dEnd];

  if (divisi && divisi !== "0") {
    sql += ` AND h.pen_divisi = ?`;
    params.push(divisi);
  }

  sql += ` ORDER BY h.pen_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// --- 2. GET BROWSE DETAIL (Detail SPK terkait) ---
const getBrowseDetail = async (nomorPenawaran) => {
  const sql = `
    SELECT 
      spk_pen_nomor AS Nomor,
      SPK_Nomor AS Spk,
      spk_Tanggal AS Tanggal,
      spk_nama AS Nama,
      spk_jumlah AS Jumlah 
    FROM tspk
    WHERE spk_aktif = 'Y' 
      AND spk_pen_nomor = ?
    ORDER BY SPK_Nomor ASC
  `;

  const [rows] = await db.query(sql, [nomorPenawaran]);
  return rows;
};

// --- 3. GET SEMUA DETAIL (untuk export tanpa expand dulu) ---
const getAllDetail = async (query, canLihatCus = false) => {
  const { startDate, endDate, divisi } = query;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const custCol = canLihatCus
    ? "c.cus_nama AS NamaCustomer,"
    : `"" AS NamaCustomer,`;

  let sql = `
    SELECT 
      h.pen_nomor       AS NomorPenawaran,
      h.pen_tanggal     AS TglPenawaran,
      v.Divisi          AS Divisi,
      ${custCol}
      h.pen_keterangan  AS Keterangan,
      s.spk_nomor       AS NomorSPK,
      s.spk_tanggal     AS TglSPK,
      s.spk_nama        AS NamaSPK,
      s.spk_jumlah      AS Jumlah
    FROM tpenawaran_hdr h
    INNER JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode
    LEFT JOIN tdivisi v    ON v.kode = h.pen_divisi
    LEFT JOIN tspk s       ON s.spk_pen_nomor = h.pen_nomor AND s.spk_aktif = 'Y'
    WHERE h.pen_tanggal >= ? AND h.pen_tanggal <= ?
  `;

  const params = [dStart, dEnd];
  if (divisi && divisi !== "0") {
    sql += ` AND h.pen_divisi = ?`;
    params.push(divisi);
  }

  sql += ` ORDER BY h.pen_nomor DESC, s.spk_nomor ASC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getAllDetail,
};
