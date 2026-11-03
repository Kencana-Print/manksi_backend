// backend/src/services/lhkPola.service.js
const pool = require("../../../config/database");

const getLHKPolaLookup = async () => {
  try {
    const sql = `
      SELECT 
        -- Header LHK Pola
        h.lhkp_nomor AS lhk_nomor,
        h.lhkp_tanggal AS lhk_tanggal,
        h.lhkp_keterangan AS lhk_keterangan,
        h.lhkp_pembuat_pola,
        h.lhkp_pembuat_marker,
        
        -- Detail Marker
        m.ldm_id,
        m.ldm_urut AS marker_urut,
        m.ldm_spk_nomor AS marker_spk_nomor,
        m.ldm_lebar_kain,
        m.ldm_size AS marker_size,
        m.ldm_tujuan_proses,
        m.ldm_mesin,
        m.ldm_keterangan AS marker_keterangan,
        
        -- Detail Grading (Diambil berdasarkan nomor dokumen yang sama)
        g.ldg_id,
        g.ldg_urut AS grading_urut,
        g.ldg_spk_nomor AS grading_spk_nomor,
        g.ldg_divisi,
        g.ldg_grading_size,
        g.ldg_panjang,
        g.ldg_lebar,
        g.ldg_keterangan AS grading_keterangan
        
      FROM tlhkpola_hdr h
      -- Join utama ke marker
      LEFT JOIN tlhkpola_marker_dtl m ON h.lhkp_nomor = m.ldm_nomor
      -- Join ke grading disamakan berdasarkan nomor dokumen (dan SPK jika diperlukan agar lebih akurat)
      LEFT JOIN tlhkpola_grading_dtl g ON h.lhkp_nomor = g.ldg_nomor 
        AND (m.ldm_spk_nomor = g.ldg_spk_nomor OR g.ldg_spk_nomor IS NULL)
      ORDER BY 
        h.lhkp_tanggal DESC, 
        h.lhkp_nomor DESC, 
        m.ldm_urut ASC
    `;

    const [rows] = await pool.execute(sql);
    return rows;
  } catch (error) {
    throw error;
  }
};

/**
 * Mengambil daftar master LHK Pola (Browse)
 */
const getAllHeaders = async ({ startDate, endDate, search = "" }) => {
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 30);
  const tglMulai = startDate || defaultStart.toISOString().substring(0, 10);
  const tglSelesai = endDate || new Date().toISOString().substring(0, 10);

  let params = [tglMulai, tglSelesai];
  let searchClause = "";

  if (search && search.trim() !== "") {
    searchClause = ` AND (
      h.lhkp_nomor LIKE ?
      OR h.lhkp_pembuat_pola LIKE ?
      OR h.lhkp_pembuat_marker LIKE ?
      OR h.lhkp_keterangan LIKE ?
    )`;
    const p = `%${search.trim()}%`;
    params.push(p, p, p, p);
  }

  const sql = `
    SELECT 
      h.lhkp_nomor AS Nomor,
      DATE_FORMAT(h.lhkp_tanggal, '%Y-%m-%d') AS Tanggal,
      h.lhkp_keterangan AS Keterangan,
      h.lhkp_pembuat_pola AS PembuatPola,
      h.lhkp_pembuat_marker AS PembuatMarker,
      h.user_create AS UserCreate,
      DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i:%s') AS DateCreate,
      IFNULL((SELECT COUNT(*) FROM tlhkpola_marker_dtl WHERE ldm_nomor = h.lhkp_nomor), 0) AS JmlMarker,
      IFNULL((SELECT COUNT(*) FROM tlhkpola_grading_dtl WHERE ldg_nomor = h.lhkp_nomor), 0) AS JmlGrading,
      (SELECT GROUP_CONCAT(DISTINCT d.ldm_spk_nomor ORDER BY d.ldm_urut SEPARATOR ', ')
       FROM tlhkpola_marker_dtl d WHERE d.ldm_nomor = h.lhkp_nomor) AS SpkNomor,
      (SELECT GROUP_CONCAT(DISTINCT NULLIF(d.ldg_divisi, '') SEPARATOR ', ')
       FROM tlhkpola_grading_dtl d WHERE d.ldg_nomor = h.lhkp_nomor) AS Divisi
    FROM tlhkpola_hdr h
    WHERE h.lhkp_tanggal BETWEEN ? AND ?
    ${searchClause}
    ORDER BY h.lhkp_tanggal DESC, h.lhkp_nomor DESC
  `;

  const [rows] = await pool.query(sql, params);
  return rows;
};

module.exports = {
  getAllHeaders,
  getLHKPolaLookup,
};
