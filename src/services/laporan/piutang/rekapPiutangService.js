const db = require("../../../config/database");

/**
 * MENGAMBIL REKAP PIUTANG (PIVOT BULAN)
 * Menjumlahkan saldo per customer (Debet - Bayar) yang dikelompokkan
 * ke dalam kolom Tahun Lalu, Jan, Feb, dst hingga bulan dari batas endDate.
 */
const getRekapPiutang = async (query) => {
  const { endDate, perusahaan } = query;

  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const year = new Date(dEnd).getFullYear();
  const startOfYear = `${year}-01-01`;

  let filterPerusahaan = "";
  const subParams = [
    startOfYear, // Tahun Lalu < Tahun ini
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year,
    year, // 12 Parameter Tahun
    dEnd, // Tgl limit untuk Subquery Bayar
    dEnd, // Tgl limit untuk Main query Debet
  ];

  if (perusahaan) {
    filterPerusahaan = " AND p.cabang = ? ";
    subParams.push(perusahaan);
  }

  // Menggunakan Conditional Aggregation untuk membuat Pivot Table otomatis
  const sql = `
    SELECT 
      p.customer AS Kode,
      c.Cus_nama AS Customer,
      SUM(CASE WHEN p.tanggal < ? THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS TahunLalu,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 1 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Jan,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 2 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Feb,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 3 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Mar,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 4 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Apr,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 5 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Mei,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 6 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Jun,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 7 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Jul,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 8 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Agu,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 9 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Sep,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 10 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Okt,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 11 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Nov,
      SUM(CASE WHEN YEAR(p.tanggal) = ? AND MONTH(p.tanggal) = 12 THEN p.debet - IFNULL(b.bayar, 0) ELSE 0 END) AS Des,
      SUM(p.debet - IFNULL(b.bayar, 0)) AS GrandTotal
    FROM piutang_debet p
    LEFT JOIN tcustomer c ON c.Cus_kode = p.customer
    LEFT JOIN (
        -- Subquery: Ambil total bayar per nota hingga tgl batas
        SELECT d.nota, SUM(d.kredit) AS bayar
        FROM piutang_kredit_detail d
        INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor
        WHERE h.tanggal >= '2021-01-01' AND h.tanggal <= ?
        GROUP BY d.nota
    ) b ON b.nota = p.nota
    WHERE p.flag = 0 
      AND p.tanggal >= '2021-01-01' 
      AND p.tanggal <= ?
      AND p.nota NOT IN (SELECT x.inv_nomor FROM tinv_hdr x WHERE x.INV_Keterangan LIKE '%INV YG DIKIRIM%')
      ${filterPerusahaan}
    GROUP BY p.customer, c.Cus_nama
    HAVING GrandTotal <> 0 OR TahunLalu <> 0 -- Hanya tampilkan yang saldonya belum lunas
    ORDER BY TahunLalu DESC, Jan DESC, Feb DESC, Mar DESC, Apr DESC, Mei DESC, Jun DESC, Jul DESC, Agu DESC, Sep DESC, Okt DESC, Nov DESC, Des DESC
  `;

  const [rows] = await db.query(sql, subParams);
  return rows;
};

module.exports = {
  getRekapPiutang,
};
