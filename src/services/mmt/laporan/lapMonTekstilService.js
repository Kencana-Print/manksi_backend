const pool = require('../../../config/database');
const { format } = require("date-fns");

const lapMonTekstil = async (startDate, endDate) => {
  const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
  const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

  const ssql = `
  SELECT 
      spk.spk_perush_kode, 
      spk.spk_tanggal, 
      spk.spk_dateline, 
      spk.spk_nomor, 
      spk.spk_nama, 
      spk.spk_panjang, 
      spk.spk_lebar, 
      spk.spk_jumlah,
      spk.spk_kain,
      (spk.spk_jumlah * spk.spk_panjang) as order_meter,
      IFNULL(zz.jml_cetak, 0) as jmlcetak,
      (spk.spk_jumlah - IFNULL(zz.jml_cetak, 0)) as jmlkurang,
      /* Tambahkan MX03 di sini */
      IFNULL(zz.mx01, 0) as mx01,
      IFNULL(zz.mx02, 0) as mx02,
      IFNULL(zz.mx03, 0) as mx03,
      IFNULL(zz.jmx01, 0) as jmx01,
      IFNULL(zz.jmx02, 0) as jmx02,
      IFNULL(zz.jmx03, 0) as jmx03,
      IFNULL(zz.cetak_meter, 0) as cetak_meter,
      zz.Tanggal_LHK
  FROM tspk spk
  LEFT JOIN (
      SELECT 
          a.ltd_spk_nomor AS Nomor_SPK,
          MAX(b.lth_tanggal) as Tanggal_LHK,
          SUM(a.ltd_qty_Cetak) as jml_cetak,
          SUM(a.ltd_qty_Cetak * s.spk_panjang) as cetak_meter,
          /* Pivot untuk 3 Mesin */
          SUM(IF(a.ltd_jns_mesin='MX01', a.ltd_qty_Cetak, 0)) as mx01,
          SUM(IF(a.ltd_jns_mesin='MX02', a.ltd_qty_Cetak, 0)) as mx02,
          SUM(IF(a.ltd_jns_mesin='MX03', a.ltd_qty_Cetak, 0)) as mx03,
          SUM(IF(a.ltd_jns_mesin='MX01', a.ltd_qty_Cetak, 0) * s.spk_panjang) as jmx01,
          SUM(IF(a.ltd_jns_mesin='MX02', a.ltd_qty_Cetak, 0) * s.spk_panjang) as jmx02,
          SUM(IF(a.ltd_jns_mesin='MX03', a.ltd_qty_Cetak, 0) * s.spk_panjang) as jmx03
      FROM tlhk_tekstilmmt_dtl a
      INNER JOIN tlhk_tekstilmmt_hdr b ON b.lth_nomor = a.ltd_lth_nomor
      INNER JOIN tspk s ON s.spk_nomor = a.ltd_spk_nomor
      WHERE b.lth_tanggal BETWEEN ? AND ?
      GROUP BY a.ltd_spk_nomor
  ) zz ON zz.Nomor_SPK = spk.spk_nomor
  WHERE spk.spk_tanggal BETWEEN ? AND ?
    AND spk.spk_aktif = 'Y'
    AND spk.spk_divisi = 5
    AND (SUBSTR(spk.spk_nomor, 4, 2) = 'MX'
         OR SUBSTR(spk.spk_nomor, 8, 2) = 'MX')
  ORDER BY spk.spk_tanggal ASC, spk.spk_nomor ASC;
  `;

  const params = [tglMulai, tglSelesai, tglMulai, tglSelesai];
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(ssql, params);
    return rows;
  } finally {
    connection.release();
  }
};

module.exports = { lapMonTekstil };