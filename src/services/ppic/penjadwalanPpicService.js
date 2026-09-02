const db = require("../../config/database");

// ── Browse header (list periode) ──
const getBrowse = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       h.pjw_nomor AS Nomor,
       DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS TglAwal,
       DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS TglAkhir,
       h.pjw_cab AS Cabang,
       h.pjw_close AS Close,
       h.pjw_keterangan AS Keterangan,
       COUNT(d.pjwd_id) AS JumlahSO
     FROM tpenjadwalan_ppic_hdr h
     LEFT JOIN tpenjadwalan_ppic_dtl d ON d.pjwd_pjw_nomor = h.pjw_nomor
     WHERE h.pjw_tgl1 BETWEEN ? AND ?
     GROUP BY h.pjw_nomor, h.pjw_tgl1, h.pjw_tgl2, h.pjw_cab, h.pjw_close, h.pjw_keterangan
     ORDER BY h.pjw_nomor ASC`,
    [startDate, endDate],
  );
  return rows;
};

// ── Detail (dipakai expand di Browse — read only, gabung data live SO) ──
const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.pjwd_id AS PjwdId,
       d.pjwd_so_nomor AS Nomor,
       d.pjwd_pro_nomor AS NomorPraOrder,
       d.pjwd_map_nomor AS NomorMap,
       CASE
         WHEN d.pjwd_so_nomor IS NOT NULL THEN 'SO'
         WHEN d.pjwd_map_nomor IS NOT NULL THEN 'MAP'
         ELSE 'PRA ORDER'
       END AS Sumber,
       COALESCE(src.Nama, mp.mspk_nama, pro.pro_nama_pekerjaan) AS Nama,
       COALESCE(src.Tanggal, DATE_FORMAT(mp.mspk_tanggal,'%Y-%m-%d'), DATE_FORMAT(pro.pro_tanggal, '%Y-%m-%d')) AS Tanggal,
       COALESCE(src.Pesan, mp.mspk_rencana_order, pro.pro_qty_rencana) AS Pesan,
       COALESCE(src.Kirim, 0, 0) AS Kirim,
       COALESCE(src.Kurang, mp.mspk_rencana_order, pro.pro_qty_rencana) AS Kurang,
       d.pjwd_rencana AS Rencana,
       IFNULL((
         SELECT SUM(jk.realisasi)
         FROM tjadwalkirim jk
         WHERE jk.spk_nomor = d.pjwd_so_nomor
           AND jk.tanggal BETWEEN h.pjw_tgl1 AND h.pjw_tgl2
       ), 0) AS Realisasi,
       DATE_FORMAT(d.pjwd_tgl_permintaan_kirim, '%Y-%m-%d') AS PermintaanKirim,
       d.pjwd_status_permintaan AS StatusPermintaan,
       DATE_FORMAT(d.pjwd_tgl_kesepakatan, '%Y-%m-%d') AS Kesepakatan,
       d.pjwd_ket_kesepakatan AS KetKesepakatan,
       pro.pro_status_ppic AS StatusPpicPraOrder
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     LEFT JOIN (
       SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
              so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
              (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang
       FROM tsalesorder
       UNION ALL
       SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
              spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0))
       FROM tspk WHERE spk_is_so = 0
     ) src ON src.Nomor = d.pjwd_so_nomor
     LEFT JOIN tmemospk mp ON mp.mspk_nomor = d.pjwd_map_nomor
     LEFT JOIN tpraorder_hdr pro ON pro.pro_nomor = d.pjwd_pro_nomor
     WHERE d.pjwd_pjw_nomor = ?
     ORDER BY Tanggal ASC`,
    [nomor],
  );
  return rows;
};

const toggleClose = async (nomor, isClose) => {
  const [rows] = await db.query(
    `SELECT pjw_close FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");
  if (isClose && rows[0].pjw_close === "Y")
    throw new Error("Periode ini sudah Close.");
  if (!isClose && rows[0].pjw_close === "N")
    throw new Error("Periode ini sudah Open.");

  await db.query(
    `UPDATE tpenjadwalan_ppic_hdr SET pjw_close = ? WHERE pjw_nomor = ?`,
    [isClose ? "Y" : "N", nomor],
  );
};

const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`,
      [nomor],
    );
    await conn.query(`DELETE FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor = ?`, [
      nomor,
    ]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  getBrowse,
  getDetail,
  toggleClose,
  deleteData,
};
