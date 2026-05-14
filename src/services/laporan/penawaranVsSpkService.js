const db = require("../../config/database");

// --- 1. GET BROWSE HEADER (Master Penawaran) ---
const getBrowse = async (query) => {
  const { startDate, endDate, divisi } = query;

  // Default tanggal: Awal bulan s/d Hari ini
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sql = `
    SELECT 
      h.pen_nomor AS Nomor,
      h.pen_tanggal AS Tanggal,
      v.Divisi AS Divisi,
      c.cus_nama AS NamaCustomer,
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

  // Logika Delphi: if leftstr(cbdivisi.Text,1)<>'0'
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

module.exports = {
  getBrowse,
  getBrowseDetail,
};
