const db = require("../../config/database");

// ============================================================
// LHK MARKER — BROWSE SERVICE
// Sumber header tetap tlhkpola_hdr (satu nomor LHK bisa punya
// pekerjaan Pola & Marker), tapi menu ini fokus ke sisi Marker —
// kolom JmlMarker ditonjolkan, dan Pembuat memakai
// lhkp_pembuat_marker (bukan lhkp_pembuat_pola).
// ============================================================

const getBrowse = async ({ startDate, endDate }) => {
  const [rows] = await db.query(
    `SELECT
       h.lhkp_nomor AS Nomor,
       DATE_FORMAT(h.lhkp_tanggal, '%Y-%m-%d') AS Tanggal,
       h.lhkp_keterangan AS Keterangan,
       h.lhkp_pembuat_marker AS Pembuat,
       h.user_create AS UserCreate,
       h.date_create AS DateCreate,
       IFNULL((SELECT COUNT(*) FROM tlhkpola_marker_dtl WHERE ldm_nomor = h.lhkp_nomor), 0) AS JmlMarker,
       (SELECT GROUP_CONCAT(d.ldm_spk_nomor ORDER BY d.ldm_urut SEPARATOR ', ')
        FROM tlhkpola_marker_dtl d WHERE d.ldm_nomor = h.lhkp_nomor) AS SpkNomor
     FROM tlhkpola_hdr h
     WHERE h.lhkp_tanggal BETWEEN ? AND ?
       AND EXISTS (
         SELECT 1 FROM tlhkpola_marker_dtl d WHERE d.ldm_nomor = h.lhkp_nomor
       )
     ORDER BY h.lhkp_tanggal DESC, h.lhkp_nomor DESC`,
    [startDate, endDate],
  );
  return rows;
};

module.exports = {
  getBrowse,
};
