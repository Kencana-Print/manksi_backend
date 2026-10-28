const db = require("../../config/database");

// Baris tab MAP/Sampel yang MAP-nya sudah jadi SO (atau yang sudah punya
// nomor SO) dihapus dari Komitmen Kirim, bukan di-upgrade jadi baris SO.
// Hanya periode Open: periode Close dibiarkan supaya Pencapaian yang sudah
// dilaporkan tidak bergeser. Best-effort, tidak boleh menggagalkan pemanggil.
const purgeMapJadiSo = async (pjwNomor = null) => {
  try {
    const params = [];
    let sql = `DELETE d FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       WHERE d.pjwd_tipe = 'MAP' AND h.pjw_close = 'N'
         AND (d.pjwd_so_nomor IS NOT NULL
              OR (d.pjwd_map_nomor IS NOT NULL AND EXISTS (
                    SELECT 1 FROM tsalesorder s
                    WHERE s.so_memo = d.pjwd_map_nomor AND s.so_aktif = 'Y')))`;
    if (pjwNomor) {
      sql += ` AND d.pjwd_pjw_nomor = ?`;
      params.push(pjwNomor);
    }
    await db.query(sql, params);
  } catch (e) {
    console.error("Gagal membersihkan baris MAP yang sudah jadi SO:", e);
  }
};

// ── Browse header (list periode) ──
const getBrowse = async (startDate, endDate, cabang = "") => {
  await purgeMapJadiSo();
  let query = `SELECT
       h.pjw_nomor AS Nomor,
       DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS TglAwal,
       DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS TglAkhir,
       h.pjw_cab AS Cabang,
       h.pjw_close AS Close,
       h.pjw_keterangan AS Keterangan,
       SUM(CASE WHEN d.pjwd_id IS NOT NULL AND d.pjwd_tipe <> 'MAP' THEN 1 ELSE 0 END) AS JumlahSO,
       SUM(CASE WHEN d.pjwd_id IS NOT NULL AND d.pjwd_tipe = 'MAP' THEN 1 ELSE 0 END) AS JumlahMap
     FROM tpenjadwalan_ppic_hdr h
     LEFT JOIN tpenjadwalan_ppic_dtl d ON d.pjwd_pjw_nomor = h.pjw_nomor
     WHERE h.pjw_tgl1 BETWEEN ? AND ?`;
  const params = [startDate, endDate];

  if (cabang) {
    query += ` AND h.pjw_cab = ?`;
    params.push(cabang);
  }

  query += ` GROUP BY h.pjw_nomor, h.pjw_tgl1, h.pjw_tgl2, h.pjw_cab, h.pjw_close, h.pjw_keterangan
     ORDER BY h.pjw_tgl1 ASC, h.pjw_cab ASC, h.pjw_nomor ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Detail (dipakai expand di Browse — read only, gabung data live SO) ──
const getDetail = async (nomor) => {
  const [[hdr]] = await db.query(
    `SELECT DATE_FORMAT(pjw_tgl1,'%Y-%m-%d') AS t1,
            DATE_FORMAT(pjw_tgl2,'%Y-%m-%d') AS t2, pjw_cab
     FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor = ?`,
    [nomor],
  );
  if (!hdr) return [];

  await purgeMapJadiSo(nomor);

  const [rows] = await db.query(
    `SELECT
       d.pjwd_id AS PjwdId,
       d.pjwd_tipe AS PjwdTipe,
       COALESCE(d.pjwd_so_nomor, sm.so_nomor) AS Nomor,
       COALESCE(so.so_spk_ref, d.pjwd_so_nomor, sm.so_nomor) AS EffRef,
       d.pjwd_pro_nomor AS NomorPraOrder,
       IF(sm.so_nomor IS NOT NULL, NULL, d.pjwd_map_nomor) AS NomorMap,
       IF(d.pjwd_so_nomor IS NOT NULL, NULL, d.pjwd_mh_nomor) AS NomorMh,
       IF(d.pjwd_so_nomor IS NOT NULL, NULL, d.pjwd_pen_nomor) AS NomorPen,
       IF(d.pjwd_so_nomor IS NOT NULL, NULL, d.pjwd_pen_id) AS PenId,
       CASE
         WHEN d.pjwd_so_nomor IS NOT NULL THEN 'SO'
         WHEN sm.so_nomor IS NOT NULL THEN 'SO'
         WHEN d.pjwd_map_nomor IS NOT NULL THEN 'MAP'
         WHEN d.pjwd_mh_nomor IS NOT NULL THEN 'PERMINTAAN HARGA'
         WHEN d.pjwd_pen_nomor IS NOT NULL THEN 'PENAWARAN'
         WHEN d.pjwd_pro_nomor IS NOT NULL THEN 'PRA ORDER'
         ELSE 'MANUAL'
       END AS Sumber,
       COALESCE(so.so_nama, sp.spk_nama, mp.mspk_nama, mh.mh_nama,
                pend.pend_nama_barang, pro.pro_nama_pekerjaan, d.pjwd_nama_manual) AS Nama,
       COALESCE(DATE_FORMAT(COALESCE(so.so_tanggal, sp.spk_tanggal),'%Y-%m-%d'),
                DATE_FORMAT(mp.mspk_tanggal,'%Y-%m-%d'),
                DATE_FORMAT(pro.pro_tanggal,'%Y-%m-%d')) AS Tanggal,
       COALESCE(so.so_panjang, sp.spk_panjang, mp.mspk_panjang, mh.mh_panjang,
                pend.pend_panjang, d.pjwd_panjang_manual, 0) AS Panjang,
       COALESCE(so.so_lebar, sp.spk_lebar, mp.mspk_lebar, mh.mh_lebar,
                pend.pend_lebar, d.pjwd_lebar_manual, 0) AS Lebar,
       CASE
         WHEN d.pjwd_tipe = 'MAP' THEN IFNULL(d.pjwd_pesan_manual, 0)
         ELSE COALESCE(so.so_jumlah, sp.spk_jumlah, pro.pro_qty_rencana, d.pjwd_pesan_manual, 0)
       END AS Pesan,
       CASE
         WHEN d.pjwd_tipe = 'MAP' AND d.pjwd_map_nomor IS NOT NULL THEN IFNULL((
           SELECT SUM(sm1.sjd_jumlah) FROM tsj_dtl_memo sm1
           WHERE sm1.sjd_mspk_nomor = CONVERT(d.pjwd_map_nomor USING latin1)
         ), 0)
         WHEN d.pjwd_tipe = 'MAP' THEN IFNULL(d.pjwd_kirim_manual, 0)
         ELSE IFNULL(COALESCE(so.so_jumlah_kirim, sp.spk_jumlah_kirim), 0)
       END AS Kirim,
       CASE
         WHEN d.pjwd_tipe = 'MAP' AND d.pjwd_map_nomor IS NOT NULL THEN GREATEST(
           IFNULL(d.pjwd_pesan_manual, 0) - IFNULL((
             SELECT SUM(sm2.sjd_jumlah) FROM tsj_dtl_memo sm2
             WHERE sm2.sjd_mspk_nomor = CONVERT(d.pjwd_map_nomor USING latin1)
           ), 0), 0)
         WHEN d.pjwd_tipe = 'MAP' THEN GREATEST(IFNULL(d.pjwd_pesan_manual,0) - IFNULL(d.pjwd_kirim_manual,0), 0)
         ELSE COALESCE(
           COALESCE(so.so_jumlah, sp.spk_jumlah)
             - IFNULL(COALESCE(so.so_jumlah_kirim, sp.spk_jumlah_kirim), 0),
           pro.pro_qty_rencana,
           (IFNULL(d.pjwd_pesan_manual,0) - IFNULL(d.pjwd_kirim_manual,0)))
       END AS Kurang,
       d.pjwd_rencana AS Rencana,
       d.pjwd_ket_rencana AS KetRencana,
       -- Realisasi: cabang MAP & manual tetap di SQL; sisanya NULL, diisi dari agregat di JS
       CASE
         WHEN d.pjwd_tipe = 'MAP' AND d.pjwd_map_nomor IS NOT NULL THEN IFNULL((
           SELECT mb.mspk_jumlah_jadi FROM tmemospk mb
           WHERE mb.mspk_nomor = CONVERT(d.pjwd_map_nomor USING latin1)
             AND EXISTS (
               SELECT 1 FROM tkesesuaianmap kb
               WHERE kb.mspk_nomor = mb.mspk_nomor
                 AND (kb.date_create IS NULL
                      OR kb.date_create < DATE_ADD(h.pjw_tgl2, INTERVAL 1 DAY)))
         ), 0)
         WHEN COALESCE(d.pjwd_so_nomor, sm.so_nomor) IS NULL
           AND d.pjwd_map_nomor IS NULL AND d.pjwd_pro_nomor IS NULL
         THEN IFNULL(d.pjwd_realisasi_manual, 0)
         ELSE NULL
       END AS Realisasi,
       DATE_FORMAT(d.pjwd_tgl_permintaan_kirim, '%Y-%m-%d') AS PermintaanKirim,
       d.pjwd_status_permintaan AS StatusPermintaan,
       DATE_FORMAT(d.pjwd_tgl_kesepakatan, '%Y-%m-%d') AS Kesepakatan,
       d.pjwd_qty_kesepakatan AS QtyKesepakatan,
       d.pjwd_ket_kesepakatan AS KetKesepakatan,
       pro.pro_status_ppic AS StatusPpicPraOrder
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     LEFT JOIN tsalesorder sm
       ON sm.so_memo = d.pjwd_map_nomor
       AND sm.so_aktif = 'Y'
       AND d.pjwd_so_nomor IS NULL
       AND sm.so_nomor = (
         SELECT MIN(x.so_nomor) FROM tsalesorder x
         WHERE x.so_memo = d.pjwd_map_nomor AND x.so_aktif = 'Y')
     LEFT JOIN tsalesorder so
       ON so.so_nomor = COALESCE(d.pjwd_so_nomor, sm.so_nomor)
     LEFT JOIN tspk sp
       ON sp.spk_nomor = CONVERT(COALESCE(d.pjwd_so_nomor, sm.so_nomor) USING latin1)
       AND sp.spk_is_so = 0
       AND so.so_nomor IS NULL
     LEFT JOIN tmemospk mp
       ON mp.mspk_nomor = CONVERT(d.pjwd_map_nomor USING latin1)
       AND sm.so_nomor IS NULL
     LEFT JOIN tpraorder_hdr pro ON pro.pro_nomor = d.pjwd_pro_nomor
     LEFT JOIN tmintaharga mh
       ON mh.mh_nomor = CONVERT(d.pjwd_mh_nomor USING latin1)
     LEFT JOIN tpenawaran_dtl pend
       ON pend.pend_pen_nomor = CONVERT(d.pjwd_pen_nomor USING latin1)
       AND pend.pend_id = d.pjwd_pen_id
     WHERE d.pjwd_pjw_nomor = ?
     ORDER BY Tanggal ASC`,
    [nomor],
  );

  // ── Realisasi SO/SPK: 2 query agregat, terbatas pada nomor yang tampil ──
  // Lalu = STBJ sebelum tgl awal periode yang belum terkirim, dihitung
  //        per tgl awal periode (STBJ sebelum - SJ sebelum).
  // Ini  = STBJ di dalam periode (tidak dikurangi kirim).
  const refs = [
    ...new Set(
      rows.filter((r) => r.Realisasi === null && r.EffRef).map((r) => r.EffRef),
    ),
  ];
  const stbj = {};
  const sj = {};
  if (refs.length) {
    const [stbjRows] = await db.query(
      `SELECT td.stbjd_spk_nomor AS ref,
              SUM(IF(th.stbj_tanggal < ?, td.stbjd_jumlah, 0)) AS beforeQty,
              SUM(IF(th.stbj_tanggal >= ?
                     AND th.stbj_tanggal < DATE_ADD(?, INTERVAL 1 DAY),
                     td.stbjd_jumlah, 0)) AS inRange
       FROM tstbj_dtl td
       INNER JOIN tstbj_hdr th ON th.stbj_nomor = td.stbjd_stbj_nomor
       WHERE td.stbjd_spk_nomor IN (?)
       GROUP BY td.stbjd_spk_nomor`,
      [hdr.t1, hdr.t1, hdr.t2, refs],
    );
    stbjRows.forEach((r) => (stbj[r.ref] = r));

    const [sjRows] = await db.query(
      `SELECT sd.sjd_spk_nomor AS ref,
              SUM(IF(sh.sj_tanggal BETWEEN ? AND ?, sd.sjd_jumlah, 0)) AS inRange,
              SUM(IF(sh.sj_tanggal < ?, sd.sjd_jumlah, 0)) AS beforeQty
       FROM tsj_dtl sd
       INNER JOIN tsj_hdr sh ON sh.sj_nomor = sd.sjd_sj_nomor
       WHERE sd.sjd_spk_nomor IN (?) AND sh.sj_approve <> 2
       GROUP BY sd.sjd_spk_nomor`,
      [hdr.t1, hdr.t2, hdr.t1, refs],
    );
    sjRows.forEach((r) => (sj[r.ref] = r));
  }

  const isP02 = hdr.pjw_cab === "P02";
  for (const r of rows) {
    if (r.Realisasi === null) {
      const s = stbj[r.EffRef];
      const j = sj[r.EffRef];
      if (isP02) {
        r.RealisasiLalu = 0;
        r.RealisasiIni = Number(j?.inRange) || 0;
      } else {
        const stbjLalu = Number(s?.beforeQty) || 0;
        const terkirimSebelum = Number(j?.beforeQty) || 0;
        r.RealisasiLalu = Math.max(stbjLalu - terkirimSebelum, 0);
        r.RealisasiIni = Number(s?.inRange) || 0;
      }
    } else {
      // MAP & baris manual: nilai lama masuk kolom minggu ini
      r.RealisasiLalu = 0;
      r.RealisasiIni = Number(r.Realisasi) || 0;
    }
    // Realisasi tetap ada = RealisasiIni supaya frontend lama tidak pecah.
    r.Realisasi = r.RealisasiIni;
    r.SpkRef = r.EffRef || null;
    delete r.EffRef;
  }

  const breakdown = await getKesepakatanBreakdown(rows.map((r) => r.PjwdId));
  for (const r of rows) r.KesepakatanBd = breakdown[r.PjwdId] || [];

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

  // Bersihkan dulu selagi periode masih Open, supaya kondisi saat Close
  // sudah tanpa baris MAP yang jadi SO.
  if (isClose) await purgeMapJadiSo(nomor);

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

const getPencapaian = async (nomor) => {
  const detailRows = await getDetail(nomor);

  const soRows = detailRows.filter((d) => d.PjwdTipe !== "MAP");
  const mapRows = detailRows.filter((d) => d.PjwdTipe === "MAP");

  const sumRencana = (rows) =>
    rows.reduce((s, d) => s + (Number(d.Rencana) || 0), 0);
  const sumRealisasi = (rows) =>
    rows.reduce((s, d) => s + (Number(d.RealisasiIni) || 0), 0);

  const [rows] = await db.query(
    `SELECT pjwp_id AS Id, pjwp_tipe AS Tipe, pjwp_kategori AS Kategori,
            pjwp_keterangan AS Keterangan, pjwp_pcs AS Pcs, pjwp_group AS Group_
     FROM tpenjadwalan_ppic_pencapaian
     WHERE pjwp_pjw_nomor = ?
     ORDER BY pjwp_tipe, pjwp_urutan ASC, pjwp_id ASC`,
    [nomor],
  );

  const soPencapaian = rows.filter((r) => r.Group_ !== "MAP");
  const mapPencapaian = rows.filter((r) => r.Group_ === "MAP");

  return {
    So: {
      Rencana: sumRencana(soRows),
      Realisasi: sumRealisasi(soRows),
      TidakTercapai: soPencapaian.filter((r) => r.Tipe === "KURANG"),
      Tambahan: soPencapaian.filter((r) => r.Tipe === "TAMBAHAN"),
    },
    Map: {
      Rencana: sumRencana(mapRows),
      Realisasi: sumRealisasi(mapRows),
      TidakTercapai: mapPencapaian.filter((r) => r.Tipe === "KURANG"),
      Tambahan: mapPencapaian.filter((r) => r.Tipe === "TAMBAHAN"),
    },
  };
};

// Replace-all — paling simpel untuk list yang bisa ditambah/hapus bebas dari UI
const savePencapaian = async (
  nomor,
  tidakTercapai = [],
  tambahan = [],
  group = null,
) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM tpenjadwalan_ppic_pencapaian WHERE pjwp_pjw_nomor = ? AND ${
        group ? "pjwp_group = ?" : "pjwp_group IS NULL"
      }`,
      group ? [nomor, group] : [nomor],
    );

    const allRows = [
      ...tidakTercapai.map((r, i) => ({ ...r, tipe: "KURANG", urutan: i })),
      ...tambahan.map((r, i) => ({ ...r, tipe: "TAMBAHAN", urutan: i })),
    ];

    for (const r of allRows) {
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_pencapaian
           (pjwp_pjw_nomor, pjwp_tipe, pjwp_group, pjwp_kategori, pjwp_keterangan, pjwp_pcs, pjwp_urutan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          r.tipe,
          group || null,
          r.kategori,
          r.keterangan || null,
          Number(r.pcs) || 0,
          r.urutan,
        ],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── Notifikasi MAP baru masuk Komitmen Kirim — per USER. Baris yang
// belum ada catatan "sudah dibaca" oleh user ini di
// tpenjadwalan_ppic_notif_read akan tampil, terlepas apakah user lain
// sudah pernah melihatnya atau belum.
const getUnnotifiedMap = async (userKode) => {
  const [rows] = await db.query(
    `SELECT
       d.pjwd_id AS PjwdId,
       d.pjwd_map_nomor AS MapNomor,
       h.pjw_nomor AS PjwNomor,
       DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS PjwTgl1,
       DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS PjwTgl2,
       h.pjw_cab AS Cab,
       m.mspk_nama AS Nama
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = d.pjwd_map_nomor
     WHERE d.pjwd_tipe = 'MAP'
       AND NOT EXISTS (
         SELECT 1 FROM tpenjadwalan_ppic_notif_read r
         WHERE r.pjwd_id = d.pjwd_id AND r.user_kode = ?
       )
     ORDER BY h.pjw_nomor, d.pjwd_id`,
    [userKode],
  );

  const byPeriode = {};
  for (const r of rows) {
    if (!byPeriode[r.PjwNomor]) {
      byPeriode[r.PjwNomor] = {
        pjwNomor: r.PjwNomor,
        tgl1: r.PjwTgl1,
        tgl2: r.PjwTgl2,
        cab: r.Cab,
        items: [],
      };
    }
    byPeriode[r.PjwNomor].items.push({
      pjwdId: r.PjwdId,
      mapNomor: r.MapNomor,
      nama: r.Nama,
    });
  }
  return Object.values(byPeriode);
};

// ── Tandai sudah dilihat OLEH USER INI — insert baris per pjwd_id,
// aman dipanggil berulang (duplicate key diabaikan).
const markMapNotified = async (pjwdIds, userKode) => {
  if (!Array.isArray(pjwdIds) || pjwdIds.length === 0) return;
  const values = pjwdIds.map((id) => [id, userKode]);
  await db.query(
    `INSERT IGNORE INTO tpenjadwalan_ppic_notif_read (pjwd_id, user_kode) VALUES ?`,
    [values],
  );
};

// Riwayat kirim aktual (semua SJ) untuk satu SPK
const getRiwayatKirim = async (spkRef) => {
  if (!spkRef) return [];
  const [rows] = await db.query(
    `SELECT sh.sj_nomor AS Nomor,
            DATE_FORMAT(sh.sj_tanggal, '%Y-%m-%d') AS Tanggal,
            sd.sjd_jumlah AS Qty
     FROM tsj_dtl sd
     INNER JOIN tsj_hdr sh ON sh.sj_nomor = sd.sjd_sj_nomor
     WHERE sd.sjd_spk_nomor = ? AND sh.sj_approve <> 2
     ORDER BY sh.sj_tanggal, sh.sj_nomor`,
    [spkRef],
  );
  return rows.map((r) => ({ ...r, Qty: Number(r.Qty) || 0 }));
};

// Breakdown jadwal sepakat untuk banyak baris sekaligus: { pjwd_id: [{Tanggal, Qty}] }
const getKesepakatanBreakdown = async (pjwdIds) => {
  if (!pjwdIds || !pjwdIds.length) return {};
  const [rows] = await db.query(
    `SELECT pjwk_pjwd_id AS Id,
            DATE_FORMAT(pjwk_tgl, '%Y-%m-%d') AS Tanggal,
            pjwk_qty AS Qty
     FROM tpenjadwalan_ppic_kesepakatan
     WHERE pjwk_pjwd_id IN (?)
     ORDER BY pjwk_tgl, pjwk_id`,
    [pjwdIds],
  );
  const hasil = {};
  for (const r of rows) {
    (hasil[r.Id] = hasil[r.Id] || []).push({
      Tanggal: r.Tanggal,
      Qty: Number(r.Qty) || 0,
    });
  }
  return hasil;
};

// ── Notifikasi SO yang masuk otomatis (berdasarkan dateline) ──
// Hanya baris yang di-auto-push (log sumber AUTO), di periode Open,
// 14 hari terakhir, dan belum dibaca user ini.
const getUnnotifiedSo = async (userKode) => {
  const [rows] = await db.query(
    `SELECT d.pjwd_id AS pjwdId, d.pjwd_so_nomor AS soNomor, s.so_nama AS nama,
            DATE_FORMAT(d.pjwd_tgl_permintaan_kirim, '%Y-%m-%d') AS dateline,
            d.pjwd_rencana AS rencana,
            h.pjw_nomor AS pjwNomor, h.pjw_cab AS cab,
            DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS tgl1,
            DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS tgl2
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     INNER JOIN tpenjadwalan_ppic_so_log l
       ON l.pso_so_nomor = d.pjwd_so_nomor AND l.pso_sumber = 'AUTO'
     LEFT JOIN tsalesorder s ON s.so_nomor = d.pjwd_so_nomor
     WHERE d.pjwd_tipe = 'SO' AND h.pjw_close = 'N'
       AND l.pso_tgl >= DATE_SUB(NOW(), INTERVAL 14 DAY)
       AND NOT EXISTS (
         SELECT 1 FROM tpenjadwalan_ppic_notif_so_read r
         WHERE r.nsr_pjwd_id = d.pjwd_id AND r.nsr_user = ?
       )
     ORDER BY h.pjw_tgl1, h.pjw_cab, h.pjw_nomor, d.pjwd_so_nomor`,
    [userKode],
  );

  const perPeriode = new Map();
  for (const r of rows) {
    if (!perPeriode.has(r.pjwNomor)) {
      perPeriode.set(r.pjwNomor, {
        pjwNomor: r.pjwNomor,
        cab: r.cab,
        tgl1: r.tgl1,
        tgl2: r.tgl2,
        items: [],
      });
    }
    perPeriode.get(r.pjwNomor).items.push({
      pjwdId: r.pjwdId,
      soNomor: r.soNomor,
      nama: r.nama || "",
      dateline: r.dateline,
      rencana: Number(r.rencana) || 0,
    });
  }
  return [...perPeriode.values()];
};

const markSoNotified = async (pjwdIds, userKode) => {
  const ids = (Array.isArray(pjwdIds) ? pjwdIds : [])
    .map(Number)
    .filter((n) => n > 0);
  if (!ids.length) return;
  await db.query(
    `INSERT IGNORE INTO tpenjadwalan_ppic_notif_so_read (nsr_pjwd_id, nsr_user)
     VALUES ?`,
    [ids.map((id) => [id, userKode])],
  );
};

module.exports = {
  getBrowse,
  getDetail,
  toggleClose,
  deleteData,
  getPencapaian,
  savePencapaian,
  getUnnotifiedMap,
  markMapNotified,
  getRiwayatKirim,
  getUnnotifiedSo,
  markSoNotified,
};
