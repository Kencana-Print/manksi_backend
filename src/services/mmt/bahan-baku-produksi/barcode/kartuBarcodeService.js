// backend/services/lapKartuStok.service.js
const pool = require("../../../../config/database"); // Sesuaikan path koneksi database Anda
const { format } = require('date-fns');

/**
 * Mengambil Rekapitulasi Kartu Stok (Master)
 */
const getKartuStokSummary = async (startDate, endDate, gdgKode) => {
  const kodeGudang = gdgKode || 'WH-16';
  const tglMulai = `${format(new Date(startDate), 'yyyy-MM-dd')} 00:00:00`;
  const tglSelesai = `${format(new Date(endDate), 'yyyy-MM-dd')} 23:59:59`;

  const sql = `
    SELECT 
      a.brg_kode AS KODE,
      a.brg_nama AS NAMA,
      ktg.ktg_nama AS KATEGORI,
      jb.jb_nama AS JENIS,
      IF(a.brg_status = 'F', 'Fast Moving', IF(a.brg_status = 'S', 'Slow Moving', '')) AS STATUS,
      a.brg_satuan AS SATUAN,
      IFNULL(a.brg_panjang, 0) AS PANJANG,
      IFNULL(a.brg_lebar, 0) AS LEBAR,
      IFNULL(b.stok_awal, 0) AS STOK_AWAL,
      IFNULL(c.rec, 0) AS TERIMA,
      IFNULL(c.retsup, 0) AS RETUR,
      IFNULL(c.kor, 0) AS KOREKSI,
      IFNULL(c.mut, 0) AS MUTASI,
      IFNULL(c.prod, 0) AS PRODUKSI,
      IFNULL(c.retprod, 0) AS RET_PRODUKSI,
      IFNULL(d.stok_akhir, 0) AS STOK_AKHIR
    FROM tbarang_mmt a

    /* Subquery b: Stok Awal (sebelum tanggal mulai) */
    LEFT JOIN (
      SELECT 
        mst_brg_kode,
        SUM(mst_stok_in - mst_stok_out) AS stok_awal
      FROM tmasterstok_mmt
      WHERE mst_tanggal < ?
        AND mst_gdg_kode = ?
      GROUP BY mst_brg_kode
    ) b ON b.mst_brg_kode = a.brg_kode

    /* Subquery c: Pergerakan / Mutasi dalam Periode Filter */
    LEFT JOIN (
      SELECT 
        mst_brg_kode,
        SUM(CASE WHEN mst_noreferensi LIKE '%REC%' THEN mst_stok_in ELSE 0 END) AS rec,
        SUM(CASE WHEN mst_noreferensi LIKE '%KOR%' THEN mst_stok_in - mst_stok_out ELSE 0 END) AS kor,
        SUM(CASE WHEN mst_noreferensi LIKE '%MTG%' THEN mst_stok_in - mst_stok_out ELSE 0 END) AS mut,
        SUM(CASE WHEN mst_noreferensi LIKE '%.MP.%' THEN mst_stok_out ELSE 0 END) AS prod,
        SUM(CASE WHEN mst_noreferensi LIKE '%RET.%' THEN mst_stok_out ELSE 0 END) AS retsup,
        SUM(CASE WHEN mst_noreferensi LIKE '%RETP.%' THEN mst_stok_in ELSE 0 END) AS retprod
      FROM tmasterstok_mmt
      WHERE mst_tanggal BETWEEN ? AND ?
        AND mst_gdg_kode = ?
      GROUP BY mst_brg_kode
    ) c ON c.mst_brg_kode = a.brg_kode

    /* Subquery d: Stok Akhir (sampai batas tanggal selesai) */
    LEFT JOIN (
      SELECT 
        mst_brg_kode,
        SUM(mst_stok_in - mst_stok_out) AS stok_akhir
      FROM tmasterstok_mmt
      WHERE mst_tanggal <= ?
        AND mst_gdg_kode = ?
      GROUP BY mst_brg_kode
    ) d ON d.mst_brg_kode = a.brg_kode

    LEFT JOIN tjenisbarang jb ON jb.jb_kode = a.brg_jenis
    LEFT JOIN tkategori ktg ON ktg.ktg_kode = a.brg_ktg_kode
    ORDER BY a.brg_kode ASC;
  `;

  const params = [
    tglMulai, kodeGudang,                // Parameter Subquery b
    tglMulai, tglSelesai, kodeGudang,     // Parameter Subquery c
    tglSelesai, kodeGudang               // Parameter Subquery d
  ];

  const [rows] = await pool.query(sql, params);
  return rows;
};

/**
 * Mengambil Rincian Transaksi / Mutasi Kartu Stok (Detail)
 */
const getKartuStokDetail = async (startDate, endDate, gdgKode, brgKode = null) => {
  const kodeGudang = gdgKode || 'WH-16';
  const tglMulai = `${format(new Date(startDate), 'yyyy-MM-dd')} 00:00:00`;
  const tglSelesai = `${format(new Date(endDate), 'yyyy-MM-dd')} 23:59:59`;

  let filterBarang = '';
  const params = [tglMulai, tglSelesai, `%${kodeGudang}%`];

  if (brgKode) {
    filterBarang = 'AND a.brg_kode = ?';
    params.push(brgKode);
  }

  const sql = `
    SELECT 
      a.brg_kode AS KODE,
      x.NOMOR,
      x.TANGGAL,
      x.KETERANGAN,
      x.GUDANG,
      x._IN,
      x._OUT,
      x.DariKe,
      x.SPK
    FROM tbarang_mmt a
    LEFT JOIN tkategori ON ktg_kode = a.brg_ktg_kode
    INNER JOIN (
      SELECT 
        mst_brg_kode AS Kode,
        mst_noreferensi AS Nomor,
        DATE_FORMAT(mst_tanggal, '%d/%m/%Y') AS Tanggal,
        mst_tanggal AS raw_tanggal,
        IF(mst_noreferensi LIKE '%MTG%', 'Mutasi Gudang',
        IF(mst_noreferensi LIKE '%REC%', 'Penerimaan Barang Supplier',
        IF(mst_noreferensi LIKE '%RETP.%', 'Retur Permintaan Produksi',
        IF(mst_noreferensi LIKE '%RET%', 'Retur Supplier',
        IF(mst_noreferensi LIKE '%KOR%', 'Koreksi Stock',
        IF(mst_noreferensi LIKE '%.MP.%', 'Permintaan Produksi', ' ')))))) AS Keterangan,
        
        gdg.gdg_nama AS Gudang,
        mst_stok_in AS _IN,
        mst_stok_out AS _OUT,
        
        IF(mst_noreferensi LIKE '%MTG%' AND mst_stok_out > 0,
          (SELECT gdg_nama FROM tmutasi_hdr_mmt INNER JOIN tgudang ON gdg_kode = mut_gdg_tujuan WHERE mut_nomor = mst_noreferensi),
          (SELECT gdg_nama FROM tmutasi_hdr_mmt INNER JOIN tgudang ON gdg_kode = mut_gdg_asal WHERE mut_nomor = mst_noreferensi AND mst_stok_in > 0)
        ) AS DariKe,
        
        (SELECT DISTINCT spk_nama 
         FROM (
            SELECT spk_nomor, spk_nama FROM tspk
            UNION ALL 
            SELECT spk_nomor_2, spk_nama FROM tspk2
            UNION ALL 
            SELECT mspk_nomor, mspk_nama FROM tmemospk
         ) spk_union 
         WHERE spk_nomor = mst_spk_nomor
        ) AS SPK

      FROM tmasterstok_mmt
      INNER JOIN tgudang gdg ON gdg.gdg_kode = mst_gdg_kode
      WHERE mst_tanggal BETWEEN ? AND ?
        AND mst_gdg_kode LIKE ?
    ) x ON x.Kode = a.brg_kode
    WHERE 1=1 ${filterBarang}
    ORDER BY a.brg_kode ASC, x.raw_tanggal ASC, x.NOMOR ASC;
  `;

  const [rows] = await pool.query(sql, params);
  return rows;
};

module.exports = {
  getKartuStokSummary,
  getKartuStokDetail
};