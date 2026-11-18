// backend/services/lapLsBahanPenolong.service.js
const pool = require('../../../config/database');
const { format } = require("date-fns");

/**
 * Mengambil Laporan List Stok Bahan Penolong
 * Master Barang: WH-16
 * Transaksi Stok: WH-BP
 */
const getReport = async (startDate, endDate) => {
    // 1. Format tanggal agar aman untuk SQL (YYYY-MM-DD)
    const tglMulai = format(new Date(startDate), "yyyy-MM-dd");
    const tglSelesai = format(new Date(endDate), "yyyy-MM-dd");

    // Definisikan kode gudang agar mudah diubah jika perlu
    const GDG_MASTER = 'WH-16';
    const GDG_TRANSAKSI = 'WH-BP';

    const ssql = `
    SELECT 
      a.brg_kode AS kode, 
      a.brg_nama AS Nama, 
      a.brg_jenis, 
      jb.jb_nama, 
      a.brg_gramasi AS Spesifikasi,
      CASE 
        WHEN a.brg_status = 'F' THEN 'Fast Moving'
        WHEN a.brg_status = 'S' THEN 'Slow Moving'
        WHEN a.brg_status = 'N' THEN 'Non Flexy'
        ELSE ''
      END AS status,
      a.brg_satuan AS Satuan,
      IFNULL(a.brg_panjang, 0) AS Panjang,
      IFNULL(a.brg_lebar, 0) AS Lebar,
      (IFNULL(a.brg_panjang, 0) * IFNULL(a.brg_lebar, 0)) AS m2,
      
      /* --- STOK AWAL (DIHITUNG DARI WH-BP) --- */
      IFNULL(stok_awal.total_stok, 0) AS stok_awal_q,
      IFNULL(stok_awal.total_stok, 0) * (IFNULL(a.brg_panjang, 0) * IFNULL(a.brg_lebar, 0)) AS stok_awal_m,
      
      /* --- MUTASI MASUK (DIHITUNG DARI WH-BP) --- */
      IFNULL(trans.total_in, 0) AS terima_q,
      IFNULL(trans.total_in, 0) * (IFNULL(a.brg_panjang, 0) * IFNULL(a.brg_lebar, 0)) AS terima_m,
      
      /* --- MUTASI KELUAR (DIHITUNG DARI WH-BP) --- */
      IFNULL(trans.total_out, 0) AS keluar_q,
      IFNULL(trans.total_out, 0) * (IFNULL(a.brg_panjang, 0) * IFNULL(a.brg_lebar, 0)) AS keluar_m,
      
      /* --- STOK AKHIR (DIHITUNG DARI WH-BP) --- */
      IFNULL(stok_akhir.total_stok, 0) AS stok_akhir_q,
      IFNULL(stok_akhir.total_stok, 0) * (IFNULL(a.brg_panjang, 0) * IFNULL(a.brg_lebar, 0)) AS stok_akhir_m
      
    FROM tbarang_mmt a
    
    /* Join Stok Awal: Berdasarkan WH-BP */
    LEFT JOIN (
      SELECT mst_brg_kode, SUM(mst_stok_in - mst_stok_out) AS total_stok
      FROM tmasterstok_mmt
      WHERE mst_tanggal < ? AND mst_gdg_kode = ?
      GROUP BY mst_brg_kode
    ) stok_awal ON stok_awal.mst_brg_kode = a.brg_kode
    
    /* Join Transaksi: Berdasarkan WH-BP */
    LEFT JOIN (
      SELECT 
        mst_brg_kode, 
        SUM(mst_stok_in) AS total_in,
        SUM(mst_stok_out) AS total_out
      FROM tmasterstok_mmt
      WHERE mst_tanggal BETWEEN ? AND ? AND mst_gdg_kode = ?
      GROUP BY mst_brg_kode
    ) trans ON trans.mst_brg_kode = a.brg_kode
    
    /* Join Stok Akhir: Berdasarkan WH-BP */
    LEFT JOIN (
      SELECT mst_brg_kode, SUM(mst_stok_in - mst_stok_out) AS total_stok
      FROM tmasterstok_mmt
      WHERE mst_tanggal <= ? AND mst_gdg_kode = ?
      GROUP BY mst_brg_kode
    ) stok_akhir ON stok_akhir.mst_brg_kode = a.brg_kode
    
    LEFT JOIN tjenisbarang jb ON jb.jb_kode = a.brg_jenis
    
    /* Filter: Master barang default WH-16 */
    WHERE a.brg_gdg_Default = ? 
      AND a.brg_ktg_kode IN ('BP')
    ORDER BY a.brg_nama ASC;
    `;

    try {
        const [rows] = await pool.query(ssql, [
            tglMulai, GDG_TRANSAKSI,              // Untuk stok_awal
            tglMulai, tglSelesai, GDG_TRANSAKSI,  // Untuk trans
            tglSelesai, GDG_TRANSAKSI,            // Untuk stok_akhir
            GDG_MASTER                            // Untuk filter WHERE utama
        ]);
        return rows;
    } catch (error) {
        console.error("Error in getReport service:", error);
        throw error;
    }
};

module.exports = {
    getReport,
};