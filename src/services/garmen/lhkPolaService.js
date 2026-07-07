const db = require("../../config/database");

// ============================================================
// LHK POLA — BROWSE SERVICE
// ============================================================

const getBrowse = async ({ startDate, endDate }) => {
  const [rows] = await db.query(
    `SELECT
       h.lhkp_nomor AS Nomor,
       DATE_FORMAT(h.lhkp_tanggal, '%Y-%m-%d') AS Tanggal,
       h.lhkp_keterangan AS Keterangan,
       h.user_create AS UserCreate,
       h.date_create AS DateCreate,
       IFNULL((SELECT COUNT(*) FROM tlhkpola_marker_dtl WHERE ldm_nomor = h.lhkp_nomor), 0) AS JmlMarker,
       IFNULL((SELECT COUNT(*) FROM tlhkpola_grading_dtl WHERE ldg_nomor = h.lhkp_nomor), 0) AS JmlGrading
     FROM tlhkpola_hdr h
     WHERE h.lhkp_tanggal BETWEEN ? AND ?
     ORDER BY h.lhkp_tanggal DESC, h.lhkp_nomor DESC`,
    [startDate, endDate],
  );
  return rows;
};

module.exports = {
  getBrowse,
};
