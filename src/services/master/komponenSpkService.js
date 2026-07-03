const db = require("../../config/database"); // Sesuaikan path

const getBrowse = async (startDate, endDate, divisiId) => {
  // 1. Logika hak akses divisi (Mengikuti Delphi)
  let filterDivisi = "";
  if (divisiId === 1) {
    filterDivisi = " AND spk_divisi IN (1,5) ";
  } else if (divisiId === 4) {
    filterDivisi = " AND spk_divisi IN (3,4,6) ";
  }

  // 2. Query Utama (Master)
  const query = `
    SELECT 
      x.Nomor, x.Tanggal, x.Map, x.Divisi, x.Cab, x.Tipe, x.Nama, x.Jumlah, x.Cetak, x.Bordir, 
      IF(xpotong + xcetak + xbordir <> 0, 'Y', 'N') AS Identifikasi
    FROM (
      SELECT 
        s.spk_nomor AS Nomor, 
        DATE_FORMAT(s.spk_tanggal, "%d-%m-%Y") AS Tanggal, 
        s.spk_cab AS Cab, 
        s.spk_memo AS Map, 
        s.spk_divisi AS Divisi, 
        s.spk_tipe AS Tipe, 
        s.spk_nama AS Nama, 
        s.spk_jumlah AS Jumlah,
        IF(s.spk_sablon="Y" OR s.spk_sublim="Y", "Y", "N") AS Cetak,
        IF(s.spk_bordir="Y", "Y", "N") AS Bordir,
        IFNULL((SELECT COUNT(p.sk_nomor) FROM tspk_komponen_potong p WHERE p.sk_nomor=s.spk_nomor), 0) AS xpotong,
        IFNULL((SELECT COUNT(c.sk_nomor) FROM tspk_komponen_cetak c WHERE c.sk_nomor=s.spk_nomor), 0) AS xcetak,
        IFNULL((SELECT COUNT(r.sk_nomor) FROM tspk_komponen_bordir r WHERE r.sk_nomor=s.spk_nomor), 0) AS xbordir
      FROM tspk s
      WHERE s.spk_is_so = 0
        AND s.spk_cmo <> "" 
        AND s.spk_aktif = "Y" 
        AND s.spk_jo_kode NOT IN ("BR","SB","SD","PL")
        AND s.spk_close = 0 
        AND s.spk_tanggal >= ? 
        AND s.spk_tanggal <= ?
        ${filterDivisi}
    ) x
    ORDER BY x.Tanggal ASC, x.Nomor ASC
  `;

  // Di query Delphi parameternya adalah startdate dan enddate
  const [rows] = await db.query(query, [startDate, endDate]);
  return rows;
};

// Query Detail (Saat baris di expand)
const getDetail = async (spkNomor) => {
  const query = `
    SELECT x.Nomor, x.Kode, b.Bhn_Name AS Komponen, x.Lini, x.Proses, x.Penempatan, x.Ukuran
    FROM (
      SELECT sk_nomor AS Nomor, sk_kode AS Kode,
             'POTONG' AS Lini, '' AS Proses, '' AS Penempatan, '' AS Ukuran
      FROM tspk_komponen_potong
      WHERE sk_nomor = ?
      UNION ALL
      SELECT kcb_nomor, kcb_kode,
             'SECOND PROCESS', kcb_proses, kcb_penempatan, kcb_ukuran
      FROM tspk_komponen_cetak_bordir
      WHERE kcb_nomor = ?
    ) x
    LEFT JOIN tbahan b ON b.Bhn_kode = x.Kode
    ORDER BY x.Lini, x.Kode
  `;
  const [rows] = await db.query(query, [spkNomor, spkNomor]);
  return rows;
};

module.exports = { getBrowse, getDetail };
