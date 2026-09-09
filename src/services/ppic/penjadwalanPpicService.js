const db = require("../../config/database");

// ── Browse header (list periode) ──
const getBrowse = async (startDate, endDate, cabang = "") => {
  let query = `SELECT
       h.pjw_nomor AS Nomor,
       DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS TglAwal,
       DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS TglAkhir,
       h.pjw_cab AS Cabang,
       h.pjw_close AS Close,
       h.pjw_keterangan AS Keterangan,
       COUNT(d.pjwd_id) AS JumlahSO
     FROM tpenjadwalan_ppic_hdr h
     LEFT JOIN tpenjadwalan_ppic_dtl d ON d.pjwd_pjw_nomor = h.pjw_nomor
     WHERE h.pjw_tgl1 BETWEEN ? AND ?`;
  const params = [startDate, endDate];

  if (cabang) {
    query += ` AND h.pjw_cab = ?`;
    params.push(cabang);
  }

  query += ` GROUP BY h.pjw_nomor, h.pjw_tgl1, h.pjw_tgl2, h.pjw_cab, h.pjw_close, h.pjw_keterangan
     ORDER BY h.pjw_nomor ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Detail (dipakai expand di Browse — read only, gabung data live SO) ──
const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.pjwd_id AS PjwdId,
       COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor) AS Nomor,
       d.pjwd_pro_nomor AS NomorPraOrder,
       IF(so_from_map.so_nomor IS NOT NULL, NULL, d.pjwd_map_nomor) AS NomorMap,
       IF(d.pjwd_so_nomor IS NOT NULL, NULL, d.pjwd_mh_nomor) AS NomorMh,     
       IF(d.pjwd_so_nomor IS NOT NULL, NULL, d.pjwd_pen_nomor) AS NomorPen,    
       IF(d.pjwd_so_nomor IS NOT NULL, NULL, d.pjwd_pen_id) AS PenId,          
       CASE
          WHEN d.pjwd_so_nomor IS NOT NULL THEN 'SO'
          WHEN so_from_map.so_nomor IS NOT NULL THEN 'SO'
          WHEN d.pjwd_map_nomor IS NOT NULL THEN 'MAP'
          WHEN d.pjwd_mh_nomor IS NOT NULL THEN 'PERMINTAAN HARGA'   
          WHEN d.pjwd_pen_nomor IS NOT NULL THEN 'PENAWARAN'          
          WHEN d.pjwd_pro_nomor IS NOT NULL THEN 'PRA ORDER'
          ELSE 'MANUAL'
        END AS Sumber,
       COALESCE(src.Nama, mp.mspk_nama, mh.mh_nama, pend.pend_nama_barang, pro.pro_nama_pekerjaan, d.pjwd_nama_manual) AS Nama,
       COALESCE(src.Tanggal, DATE_FORMAT(mp.mspk_tanggal,'%Y-%m-%d'), DATE_FORMAT(pro.pro_tanggal, '%Y-%m-%d'), NULL) AS Tanggal,
       COALESCE(src.Pesan, mp.mspk_rencana_order, pro.pro_qty_rencana, d.pjwd_pesan_manual, 0) AS Pesan,
       COALESCE(src.Kirim, 0, 0, d.pjwd_kirim_manual, 0) AS Kirim,
       COALESCE(src.Kurang, mp.mspk_rencana_order, pro.pro_qty_rencana,
         (IFNULL(d.pjwd_pesan_manual,0) - IFNULL(d.pjwd_kirim_manual,0))) AS Kurang,
       d.pjwd_rencana AS Rencana,
       d.pjwd_ket_rencana AS KetRencana,
       IF(
         COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor) IS NULL
           AND d.pjwd_map_nomor IS NULL AND d.pjwd_pro_nomor IS NULL,
         IFNULL(d.pjwd_realisasi_manual, 0),
         IFNULL((
           SELECT SUM(sd.sjd_jumlah)
           FROM tjadwalkirim jk
           INNER JOIN tjadwalkirim_dtl jkd ON jkd.nomor_kirim = jk.Nomor_Kirim
           INNER JOIN tsj_dtl sd
             ON sd.sjd_nokirim = jkd.nomor_kirim
             AND sd.sjd_idkirim = jkd.No_urut
           INNER JOIN tsj_hdr sh ON sh.sj_nomor = sd.sjd_sj_nomor
           WHERE jk.spk_nomor = COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor)
             AND jk.tanggal BETWEEN h.pjw_tgl1 AND h.pjw_tgl2
             AND sh.sj_approve = 1
        ), 0)
       ) AS Realisasi,
       DATE_FORMAT(d.pjwd_tgl_permintaan_kirim, '%Y-%m-%d') AS PermintaanKirim,
       d.pjwd_status_permintaan AS StatusPermintaan,
       DATE_FORMAT(d.pjwd_tgl_kesepakatan, '%Y-%m-%d') AS Kesepakatan,
       d.pjwd_ket_kesepakatan AS KetKesepakatan,
       pro.pro_status_ppic AS StatusPpicPraOrder
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     -- ⬅ BARU: cari SO yang "berasal dari" MAP ini (so_memo = nomor MAP).
     -- Kalau ketemu, baris ini otomatis dianggap sumbernya SO, bukan
     -- MAP lagi — tanpa perlu update apa pun ke tpenjadwalan_ppic_dtl.
     LEFT JOIN tsalesorder so_from_map
       ON so_from_map.so_memo = d.pjwd_map_nomor
       AND so_from_map.so_aktif = 'Y'
       AND d.pjwd_so_nomor IS NULL
     LEFT JOIN (
       SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
              so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
              (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang
       FROM tsalesorder
       UNION ALL
       SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
              spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0))
       FROM tspk WHERE spk_is_so = 0
     ) src ON src.Nomor = COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor)
     LEFT JOIN tmemospk mp
       ON mp.mspk_nomor = d.pjwd_map_nomor
       AND so_from_map.so_nomor IS NULL
     LEFT JOIN tpraorder_hdr pro ON pro.pro_nomor = d.pjwd_pro_nomor
     LEFT JOIN tmintaharga mh ON mh.mh_nomor = d.pjwd_mh_nomor
     LEFT JOIN tpenawaran_dtl pend
      ON pend.pend_pen_nomor = d.pjwd_pen_nomor AND pend.pend_id = d.pjwd_pen_id
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
