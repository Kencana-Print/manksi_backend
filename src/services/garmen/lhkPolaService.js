const db = require("../../config/database");

const getBrowse = async ({ startDate, endDate }) => {
  const [rows] = await db.query(
    `SELECT
       h.lhkp_nomor AS Nomor,
       DATE_FORMAT(h.lhkp_tanggal, '%Y-%m-%d') AS Tanggal,
       h.lhkp_keterangan AS Keterangan,
       h.lhkp_pembuat_pola AS Pembuat,
       h.user_create AS UserCreate,
       h.date_create AS DateCreate,
       IFNULL((SELECT COUNT(*) FROM tlhkpola_marker_dtl WHERE ldm_nomor = h.lhkp_nomor), 0) AS JmlMarker,
       IFNULL((SELECT COUNT(*) FROM tlhkpola_grading_dtl WHERE ldg_nomor = h.lhkp_nomor), 0) AS JmlGrading,
       (SELECT GROUP_CONCAT(d.ldg_spk_nomor ORDER BY d.ldg_urut SEPARATOR ', ')
        FROM tlhkpola_grading_dtl d WHERE d.ldg_nomor = h.lhkp_nomor) AS SpkNomor,
       (SELECT GROUP_CONCAT(DISTINCT NULLIF(d.ldg_divisi, '') SEPARATOR ', ')
        FROM tlhkpola_grading_dtl d WHERE d.ldg_nomor = h.lhkp_nomor) AS Divisi
     FROM tlhkpola_hdr h
     WHERE h.lhkp_tanggal BETWEEN ? AND ?
       AND EXISTS (
         SELECT 1 FROM tlhkpola_grading_dtl d WHERE d.ldg_nomor = h.lhkp_nomor
       )
     ORDER BY h.lhkp_tanggal DESC, h.lhkp_nomor DESC`,
    [startDate, endDate],
  );
  return rows;
};

module.exports = {
  getBrowse,
};
