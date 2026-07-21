const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — SPK aktif, belum close, cabang P04, finishing DTF, dan
// BELUM ada PO DTF (opsional difilter ke supplier tujuan tertentu).
// Flat query, tidak ada detail.
// ─────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  cab = "P04",
  supplierKode = "",
) => {
  let subWhere = "";
  const params = [cab];
  if (supplierKode) {
    subWhere = "WHERE h.pjh_sup_kode = ?";
    params.push(supplierKode);
  }
  params.push(startDate, endDate);

  const sql = `
    SELECT
      s.spk_nomor AS SPK,
      v.divisi AS Divisi,
      s.spk_cab AS Workshop,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      s.spk_nama AS Nama,
      s.spk_jumlah AS OrderQty,
      s.spk_jumlah_kirim AS Kirim,
      s.spk_finishing AS Finishing
    FROM tspk s
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    WHERE s.spk_cmo <> '' AND s.spk_aktif = 'Y' AND s.spk_close = 0
      AND s.spk_cab = ? AND s.spk_finishing LIKE '%DTF%'
      AND s.spk_nomor NOT IN (
        SELECT d.pjd_spk
        FROM tpodtf_hdr h
        INNER JOIN tpodtf_dtl d ON d.pjd_nomor = h.pjh_nomor
        ${subWhere}
      )
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
    ORDER BY s.spk_dateline
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
};
