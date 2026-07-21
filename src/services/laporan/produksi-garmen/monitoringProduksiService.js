const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — pivot per tanggal x lini produksi, langsung via
// SUM(CASE WHEN...) — pengganti efisien dari teknik CREATE TEMP
// TABLE + loop insert per baris di Delphi. Marker bahan "LL-000400"
// dipakai persis Delphi (representasi progress, bukan filter bahan
// riil). ✅ BUG FIXED (sesuai konfirmasi): cabang ALL sekarang pakai
// enddate yang benar (sebelumnya di Delphi enddate diabaikan,
// filternya selalu startdate<=tgl<=startdate).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cab = "P04") => {
  let where = `
    WHERE d.mpd_bhn_kode = 'LL-000400'
      AND h.mph_tanggal >= ? AND h.mph_tanggal <= ?
  `;
  const params = [startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND h.mph_cab = ?`;
    params.push(cab);
  }

  const sql = `
    SELECT
      DATE_FORMAT(h.mph_tanggal, '%Y-%m-%d') AS Tanggal,
      SUM(CASE WHEN h.mph_gdgasal IN ('GP001','GP015') THEN d.mpd_jumlah ELSE 0 END) AS Potong,
      SUM(CASE WHEN h.mph_gdgasal IN ('GP012','GP021') THEN d.mpd_jumlah ELSE 0 END) AS QcPotong,
      SUM(CASE WHEN h.mph_gdgasal IN ('GP002','GP017') THEN d.mpd_jumlah ELSE 0 END) AS Cetak,
      SUM(CASE WHEN h.mph_gdgasal IN ('GP009','GP027') THEN d.mpd_jumlah ELSE 0 END) AS PresDtf,
      SUM(CASE WHEN h.mph_gdgasal IN ('GP010','GP022') THEN d.mpd_jumlah ELSE 0 END) AS QcCetak,
      SUM(CASE WHEN h.mph_gdgasal = 'GP032' THEN d.mpd_jumlah ELSE 0 END) AS Dc,
      SUM(CASE WHEN h.mph_gdgasal IN ('GP003','GP018') THEN d.mpd_jumlah ELSE 0 END) AS Jahit,
      SUM(CASE WHEN h.mph_gdgasal IN ('GP004','GP019') THEN d.mpd_jumlah ELSE 0 END) AS Lipat
    FROM tmutasiproduksi_hdr h
    INNER JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor
    ${where}
    GROUP BY h.mph_tanggal
    ORDER BY h.mph_tanggal
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
};
