// backend/src/services/laporanKirim.service.js
const pool = require('../../../config/database');

const getLaporanKirimanBySPK = async (startDate, endDate, cabang = "P05") => {
  let params = [startDate, endDate, startDate, endDate];

  let sql = `
    SELECT 
      s.spk_nomor AS SPK,
      s.spk_nama AS Nama_SPK,
      IFNULL(s.spk_panjang, 0) AS Panjang,
      IFNULL(s.spk_lebar, 0) AS Lebar,
      IFNULL(s.spk_jumlah, 0) AS Order_Pcs,
      (IFNULL(s.spk_jumlah, 0) * IFNULL(s.spk_panjang, 0)) AS Order_Meter,
      
      -- Total Dijadwalkan dalam rentang tanggal
      IFNULL(jadwal_data.Total_Jadwal_Pcs, 0) AS Dijadwalkan_Pcs,
      (IFNULL(jadwal_data.Total_Jadwal_Pcs, 0) * IFNULL(s.spk_panjang, 0)) AS Dijadwalkan_Meter,
      IFNULL(jadwal_data.Total_Jadwal_Koli, 0) AS Dijadwalkan_Koli,
      
      -- Total Dikirim (SJ Approve = 1)
      IFNULL(realisasi_data.Total_Kirim_Pcs, 0) AS Dikirim_Pcs,
      IFNULL(realisasi_data.Total_Kirim_Meter, 0) AS Dikirim_Meter,
      IFNULL(realisasi_data.Total_Kirim_Koli, 0) AS Dikirim_Koli,
      
      -- Kurang Kirim (Dijadwalkan - Dikirim)
      (IFNULL(jadwal_data.Total_Jadwal_Pcs, 0) - IFNULL(realisasi_data.Total_Kirim_Pcs, 0)) AS Kurang_Pcs,
      ((IFNULL(jadwal_data.Total_Jadwal_Pcs, 0) - IFNULL(realisasi_data.Total_Kirim_Pcs, 0)) * IFNULL(s.spk_panjang, 0)) AS Kurang_Meter,
      (IFNULL(jadwal_data.Total_Jadwal_Koli, 0) - IFNULL(realisasi_data.Total_Kirim_Koli, 0)) AS Kurang_Koli

    FROM (
      SELECT spk_nomor, spk_nama, spk_panjang, spk_lebar, spk_jumlah FROM tspk WHERE spk_aktif = 'Y' AND spk_cab = ?
      UNION ALL
      SELECT mspk_nomor, mspk_nama, mspk_panjang, mspk_lebar, mspk_jumlah FROM tmemospk WHERE mspk_cab = ?
    ) s
    
    -- Subquery Jadwal Kirim berdasarkan rentang tanggal
    LEFT JOIN (
      SELECT 
        j.spk_nomor,
        SUM(IFNULL(j.Jumlah, 0)) AS Total_Jadwal_Pcs,
        SUM(IFNULL(j.Koli, 0)) AS Total_Jadwal_Koli
      FROM tjadwalkirim j
      WHERE j.Tanggal >= ? AND j.Tanggal <= ?
      GROUP BY j.spk_nomor
    ) jadwal_data ON jadwal_data.spk_nomor = s.spk_nomor

    -- Subquery Realisasi Kirim (Surat Jalan Approved)
    LEFT JOIN (
      SELECT 
        d.sjd_spk_nomor,
        SUM(d.sjd_jumlah) AS Total_Kirim_Pcs,
        SUM(d.sjd_jumlah * IFNULL(s_dtl.spk_panjang, 0)) AS Total_Kirim_Meter,
        SUM(d.sjd_koli) AS Total_Kirim_Koli
      FROM tsj_dtl d
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      LEFT JOIN tspk s_dtl ON s_dtl.spk_nomor = d.sjd_spk_nomor
      WHERE h.sj_status_otomatis = 0 AND h.sj_approve = 1 AND h.sj_tanggal >= ? AND h.sj_tanggal <= ?
      GROUP BY d.sjd_spk_nomor
    ) realisasi_data ON realisasi_data.sjd_spk_nomor = s.spk_nomor

    WHERE jadwal_data.Total_Jadwal_Pcs > 0 OR realisasi_data.Total_Kirim_Pcs > 0
  `;

  // Parameter binding:
  // 1 & 2 untuk tspk dan tmemospk (cabang),
  // 3 & 4 untuk jadwal_data (startDate, endDate),
  // 5 & 6 untuk realisasi_data (startDate, endDate)
  const queryParams = [cabang, cabang, startDate, endDate, startDate, endDate];

  sql += ` ORDER BY s.spk_nomor ASC`;

  try {
    const [rows] = await pool.query(sql, queryParams);
    return rows;
  } catch (error) {
    console.error("Error Laporan Kiriman by SPK:", error.message);
    throw new Error("Gagal mengambil laporan kirim per SPK: " + error.message);
  }
};

module.exports = {
  getLaporanKirimanBySPK,
};
