const db = require("../../../../config/database");

// ── Browse header (list periode) ──
const getBrowse = async (startDate, endDate, cabang = "") => {
  // Guard: tanggal kosong ("") di-skip agar tidak jadi klausa zero-date.
  const dateConds = [];
  const params = [];
  if (startDate) {
    dateConds.push(`h.pjw_tgl1 >= ?`);
    params.push(startDate);
  }
  if (endDate) {
    dateConds.push(`h.pjw_tgl1 <= ?`);
    params.push(endDate);
  }
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
     WHERE ${dateConds.length ? dateConds.join(" AND ") : "1=1"}`;

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
       d.pjwd_tipe AS PjwdTipe,
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
       -- ⬅ BARU: Panjang & Lebar, ambil dari sumber yang sesuai; Pra Order belum punya kolomnya jadi tidak diikutkan
       COALESCE(src.Panjang, mp.mspk_panjang, mh.mh_panjang, pend.pend_panjang, d.pjwd_panjang_manual, 0) AS Panjang,
       COALESCE(src.Lebar, mp.mspk_lebar, mh.mh_lebar, pend.pend_lebar, d.pjwd_lebar_manual, 0) AS Lebar,
       CASE
         WHEN d.pjwd_tipe = 'MAP' THEN IFNULL(d.pjwd_pesan_manual, 0)
         ELSE COALESCE(src.Pesan, pro.pro_qty_rencana, d.pjwd_pesan_manual, 0)
       END AS Pesan,
       CASE
         WHEN d.pjwd_tipe = 'MAP' THEN IFNULL(d.pjwd_kirim_manual, 0)
         ELSE COALESCE(src.Kirim, 0, d.pjwd_kirim_manual, 0)
       END AS Kirim,
       CASE
         WHEN d.pjwd_tipe = 'MAP' THEN GREATEST(IFNULL(d.pjwd_pesan_manual,0) - IFNULL(d.pjwd_kirim_manual,0), 0)
         ELSE COALESCE(src.Kurang, pro.pro_qty_rencana,
           (IFNULL(d.pjwd_pesan_manual,0) - IFNULL(d.pjwd_kirim_manual,0)))
       END AS Kurang,
       d.pjwd_rencana AS Rencana,
       d.pjwd_ket_rencana AS KetRencana,
              CASE
         WHEN d.pjwd_tipe = 'MAP' THEN IFNULL(d.pjwd_realisasi_manual, 0)
         WHEN COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor) IS NULL
           AND d.pjwd_map_nomor IS NULL AND d.pjwd_pro_nomor IS NULL
         THEN IFNULL(d.pjwd_realisasi_manual, 0)
         WHEN h.pjw_cab = 'P02' THEN IFNULL((
           SELECT SUM(sd.sjd_jumlah)
           FROM tsj_dtl sd
           INNER JOIN tsj_hdr sh ON sh.sj_nomor = sd.sjd_sj_nomor
           WHERE sd.sjd_spk_nomor = COALESCE(
             (SELECT so.so_spk_ref FROM tsalesorder so
             WHERE so.so_nomor = COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor)),
             COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor)
           )
             AND sh.sj_approve <> 2
             AND sh.sj_tanggal BETWEEN h.pjw_tgl1 AND h.pjw_tgl2
         ), 0)
         ELSE IFNULL((
           SELECT SUM(td.stbjd_jumlah)
           FROM tstbj_dtl td
           INNER JOIN tstbj_hdr th ON th.stbj_nomor = td.stbjd_stbj_nomor
           WHERE td.stbjd_spk_nomor = COALESCE(
             (SELECT so.so_spk_ref FROM tsalesorder so
             WHERE so.so_nomor = COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor)),
             COALESCE(d.pjwd_so_nomor, so_from_map.so_nomor)
           )
           AND th.stbj_tanggal BETWEEN h.pjw_tgl1 AND h.pjw_tgl2
         ), 0)
       END AS Realisasi,
       DATE_FORMAT(d.pjwd_tgl_permintaan_kirim, '%Y-%m-%d') AS PermintaanKirim,
       d.pjwd_status_permintaan AS StatusPermintaan,
       DATE_FORMAT(d.pjwd_tgl_kesepakatan, '%Y-%m-%d') AS Kesepakatan,
       d.pjwd_ket_kesepakatan AS KetKesepakatan,
       pro.pro_status_ppic AS StatusPpicPraOrder
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     LEFT JOIN tsalesorder so_from_map
       ON so_from_map.so_memo = d.pjwd_map_nomor
       AND so_from_map.so_aktif = 'Y'
       AND d.pjwd_so_nomor IS NULL
     LEFT JOIN (
       SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
              so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
              (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang,
              so_panjang AS Panjang, so_lebar AS Lebar
       FROM tsalesorder
       UNION ALL
       SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
              spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0)),
              spk_panjang, spk_lebar
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

const getPencapaian = async (nomor) => {
  const detailRows = await getDetail(nomor);

  const soRows = detailRows.filter((d) => d.PjwdTipe !== "MAP");
  const mapRows = detailRows.filter((d) => d.PjwdTipe === "MAP");

  const sumRencana = (rows) =>
    rows.reduce((s, d) => s + (Number(d.Rencana) || 0), 0);
  const sumRealisasi = (rows) =>
    rows.reduce((s, d) => s + (Number(d.Realisasi) || 0), 0);

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

const generateNomor = async (tahun) => {
  const prefix = `KK.${tahun}.`;
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(pjw_nomor, ?, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor LIKE ?`,
    [prefix.length + 1, `${prefix}%`],
  );
  const nextVal = Number(row.jumlah) + 1;
  return `${prefix}${String(nextVal).padStart(5, "0")}`;
};

// ── Lookup Cabang (workshop) — dibatasi 4 cabang yang relevan utk
// Komitmen Kirim PPIC (P01/P02/P04/P05); cabang lain sengaja tidak
// ditampilkan sebagai opsi di form ini.
const getCabangOptions = async () => {
  const [rows] = await db.query(
    `SELECT pab_kode AS Kode, pab_nama AS Nama
     FROM tpabrik
     WHERE pab_kode IN ('P01','P02','P04','P05')
     ORDER BY pab_kode`,
  );
  return rows;
};

// ── Lookup Divisi ──
const getDivisiOptions = async () => {
  const [rows] = await db.query(
    `SELECT kode AS Kode, Divisi AS Nama FROM tdivisi ORDER BY kode`,
  );
  return rows;
};

// ── Tarik SO — sekarang dengan filter divisi opsional ──
const searchSoKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT src.Nomor, src.Nama, src.Tanggal, src.Pesan, src.Kirim, src.Kurang, src.DatelineAsli
    FROM (
      SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
             so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
             (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang,
             so_dateline AS DatelineAsli, so_divisi AS Divisi
      FROM tsalesorder
      WHERE so_aktif = 'Y' AND so_close = 0
      UNION ALL
      SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
             spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0)),
             spk_dateline, spk_divisi
      FROM tspk
      WHERE spk_aktif = 'Y' AND spk_close = 0 AND spk_is_so = 0
    ) src
    WHERE src.DatelineAsli BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (divisi && divisi !== "0") {
    query += ` AND src.Divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY src.DatelineAsli ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Tarik dari Pra Order — TIDAK menunggu pro_status_ppic='SANGGUP'.
// Syaratnya cukup pro_status='OPEN' (belum dikonversi ke Permintaan
// Harga) dan tanggal rencana kirim jatuh di periode ini. Tujuannya:
// PPIC memasukkan rencana order ke jadwal SEBAGAI bagian dari proses
// menimbang kesanggupan itu sendiri — bukan langkah sesudahnya.
const searchPraOrderKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT
      h.pro_nomor AS Nomor,
      h.pro_nama_pekerjaan AS Nama,
      DATE_FORMAT(h.pro_tanggal, '%Y-%m-%d') AS Tanggal,
      h.pro_qty_rencana AS QtyRencana,
      DATE_FORMAT(h.pro_tgl_kirim, '%Y-%m-%d') AS TglKirim,
      h.pro_status_ppic AS StatusPpic,
      h.pro_divisi AS Divisi
    FROM tpraorder_hdr h
    WHERE h.pro_status = 'OPEN'
      AND h.pro_tgl_kirim BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (divisi && divisi !== "0") {
    query += ` AND h.pro_divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY h.pro_tgl_kirim ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Info 1 SO (tambah manual) ── (tidak berubah)
const getSoInfo = async (soNomor, divisi = "", excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT Nomor, Nama, Tanggal, Pesan, Kirim, Kurang, Divisi, DatelineAsli FROM (
       SELECT so_nomor AS Nomor, so_nama AS Nama, DATE_FORMAT(so_tanggal,'%Y-%m-%d') AS Tanggal,
              so_jumlah AS Pesan, IFNULL(so_jumlah_kirim,0) AS Kirim,
              (so_jumlah - IFNULL(so_jumlah_kirim,0)) AS Kurang, so_divisi AS Divisi,
              DATE_FORMAT(so_dateline,'%Y-%m-%d') AS DatelineAsli
       FROM tsalesorder WHERE so_nomor = ?
       UNION ALL
       SELECT spk_nomor, spk_nama, DATE_FORMAT(spk_tanggal,'%Y-%m-%d'),
              spk_jumlah, IFNULL(spk_jumlah_kirim,0), (spk_jumlah - IFNULL(spk_jumlah_kirim,0)), spk_divisi,
              DATE_FORMAT(spk_dateline,'%Y-%m-%d')
       FROM tspk WHERE spk_nomor = ? AND spk_is_so = 0
     ) x LIMIT 1`,
    [soNomor, soNomor],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `SO ${soNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi SO: ${row.Divisi}).`,
    );
  }

  return row;
};

// ── Tarik dari MAP (Memo Approval Produk) — tahap sebelum SPK/SO,
// filter mspk_aktif='Y' AND mspk_close=0 (belum jadi SPK/SO), dan
// belum ditarik ke periode lain.
const searchMapKandidat = async (
  startDate,
  endDate,
  divisi = "",
  excludeNomor = "",
) => {
  let query = `
    SELECT mspk_nomor AS Nomor, mspk_nama AS Nama,
           DATE_FORMAT(mspk_tanggal,'%Y-%m-%d') AS Tanggal,
           mspk_rencana_order AS Pesan,
           0 AS Kirim,
           mspk_rencana_order AS Kurang,
           DATE_FORMAT(mspk_dateline, '%Y-%m-%d') AS DatelineAsli, mspk_divisi AS Divisi
    FROM tmemospk
    WHERE mspk_aktif = 'Y' AND mspk_close = 0
      AND mspk_dateline BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (divisi && divisi !== "0") {
    query += ` AND mspk_divisi = ?`;
    params.push(divisi);
  }
  query += ` ORDER BY mspk_dateline ASC`;

  const [rows] = await db.query(query, params);
  return rows;
};

// ── Info 1 MAP (tambah manual) — dengan validasi Divisi ──
const getMapInfo = async (
  mapNomor,
  divisi = "",
  excludeNomor = "",
  periodeTgl1 = null,
  periodeTgl2 = null,
) => {
  const [rows] = await db.query(
    `SELECT
       m.mspk_nomor AS Nomor, m.mspk_nama AS Nama,
       DATE_FORMAT(m.mspk_tanggal,'%Y-%m-%d') AS Tanggal,
       m.mspk_jumlah AS Pesan,
       m.mspk_jumlah_kirim AS KirimTotal,
       m.mspk_jumlah_jadi AS RealisasiTotal,
       DATE_FORMAT(m.mspk_dateline, '%Y-%m-%d') AS DatelineAsli,
       m.mspk_divisi AS Divisi
     FROM tmemospk m WHERE m.mspk_nomor = ?`,
    [mapNomor],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `MAP ${mapNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi MAP: ${row.Divisi}).`,
    );
  }

  let kirimPeriode = 0;
  let realisasiPeriode = 0;

  if (periodeTgl1 && periodeTgl2) {
    const [[kirimRow]] = await db.query(
      `SELECT IFNULL(SUM(d.sjd_jumlah), 0) AS total
       FROM tsj_dtl_memo d
       INNER JOIN tsj_hdr_memo h ON h.sj_nomor = d.sjd_sj_nomor
       WHERE d.sjd_mspk_nomor = ? AND h.sj_tanggal BETWEEN ? AND ?`,
      [mapNomor, periodeTgl1, periodeTgl2],
    );
    kirimPeriode = Number(kirimRow.total) || 0;

    // BAST (tkesesuaianmap) yang disentuh (dibuat/diupdate) di periode
    // ini dianggap merepresentasikan realisasi periode ini — qty
    // jadinya tetap dari mspk_jumlah_jadi (satu-satunya sumber qty).
    const [[bastRow]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM tkesesuaianmap
       WHERE mspk_nomor = ?
         AND (
           DATE(date_create) BETWEEN ? AND ?
           OR DATE(date_modify) BETWEEN ? AND ?
         )`,
      [mapNomor, periodeTgl1, periodeTgl2, periodeTgl1, periodeTgl2],
    );
    if (Number(bastRow.cnt) > 0) {
      realisasiPeriode = Number(row.RealisasiTotal) || 0;
    }
  }

  return {
    ...row,
    Kirim: kirimPeriode,
    Kurang: Math.max(Number(row.Pesan) - Number(row.KirimTotal), 0),
    Realisasi: realisasiPeriode,
  };
};

// ── Info 1 MH (tambah manual) — dengan validasi Divisi & duplikasi ──
const getMhInfo = async (mhNomor, divisi = "", excludeNomor = "") => {
  const [rows] = await db.query(
    `SELECT mh_nomor AS Nomor, mh_nama AS Nama,
            DATE_FORMAT(mh_tanggal,'%Y-%m-%d') AS Tanggal,
            mh_jmlorder AS Pesan,
            0 AS Kirim,
            mh_jmlorder AS Kurang,
            mh_divisi AS Divisi,
            mh_status AS Status
     FROM tmintaharga WHERE mh_nomor = ?`,
    [mhNomor],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.Status === "CANCEL") {
    throw new Error(`MH ${mhNomor} sudah di-cancel.`);
  }
  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `MH ${mhNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi MH: ${row.Divisi}).`,
    );
  }

  return row;
};

// ── Daftar baris detail 1 Penawaran (buat picker "pilih baris") ──
// Cuma baris yang belum jadi SPK/SO (spk kosong) DAN bukan status
// batal murni — supaya user nggak pilih baris yang udah nggak
// relevan lagi.
const getPenawaranDetailList = async (penNomor) => {
  const [hdrRows] = await db.query(
    `SELECT pen_nomor, pen_divisi FROM tpenawaran_hdr WHERE pen_nomor = ?`,
    [penNomor],
  );
  if (!hdrRows.length) return null;

  const [rows] = await db.query(
    `SELECT
       d.pend_id AS PendId,
       d.pend_nama_barang AS Nama,
       d.pend_ukuran AS Ukuran,
       d.pend_qty AS Qty,
       d.pend_harga AS Harga,
       d.pend_status AS Status,
       IFNULL(
         (SELECT so.so_nomor FROM tsalesorder so
          WHERE so.so_pen_nomor = d.pend_pen_nomor AND so.so_pen_id = d.pend_id
            AND so.so_aktif = 'Y' LIMIT 1),
         (SELECT s.spk_nomor FROM tspk s
          WHERE s.spk_pen_nomor = d.pend_pen_nomor AND s.spk_pen_id = d.pend_id
            AND s.spk_is_so = 1 AND s.spk_aktif = 'Y' LIMIT 1)
       ) AS SudahJadiSo
     FROM tpenawaran_dtl d
     WHERE d.pend_pen_nomor = ?
       AND d.pend_batal NOT LIKE 'HANYA ALTERNATIF%'
     ORDER BY d.pend_urutan`,
    [penNomor],
  );

  return { divisi: hdrRows[0].pen_divisi, items: rows };
};

// ── Info 1 baris Penawaran spesifik (setelah user pilih dari picker) ──
const getPenawaranItemInfo = async (
  penNomor,
  pendId,
  divisi = "",
  excludeNomor = "",
) => {
  const [rows] = await db.query(
    `SELECT
       h.pen_nomor AS PenNomor, h.pen_divisi AS Divisi,
       d.pend_id AS PendId, d.pend_nama_barang AS Nama,
       DATE_FORMAT(h.pen_tanggal,'%Y-%m-%d') AS Tanggal,
       d.pend_qty AS Pesan, 0 AS Kirim, d.pend_qty AS Kurang
     FROM tpenawaran_dtl d
     INNER JOIN tpenawaran_hdr h ON h.pen_nomor = d.pend_pen_nomor
     WHERE d.pend_pen_nomor = ? AND d.pend_id = ?`,
    [penNomor, pendId],
  );
  const row = rows[0];
  if (!row) return null;

  if (divisi && String(row.Divisi) !== String(divisi)) {
    throw new Error(
      `Penawaran ${penNomor} bukan divisi yang sesuai dengan Cabang terpilih (Divisi: ${row.Divisi}).`,
    );
  }

  return row;
};

// ── SINKRONISASI: cari baris MH/Penawaran yang belum resolve ke SO,
// coba resolve. Kalau resolve ke >1 SO, split jadi baris tambahan.
// Dipanggil dari getFormDetail() setiap form dibuka. ──
const resolveSourceForPeriod = async (pjwNomor) => {
  const [pendingRows] = await db.query(
    `SELECT pjwd_id, pjwd_mh_nomor, pjwd_pen_nomor, pjwd_pen_id
     FROM tpenjadwalan_ppic_dtl
     WHERE pjwd_pjw_nomor = ?
       AND pjwd_so_nomor IS NULL
       AND (pjwd_mh_nomor IS NOT NULL OR pjwd_pen_nomor IS NOT NULL)`,
    [pjwNomor],
  );
  if (!pendingRows.length) return;

  for (const row of pendingRows) {
    let soList = [];

    if (row.pjwd_mh_nomor) {
      const [found] = await db.query(
        `SELECT DISTINCT resolved.so_nomor AS SoNomor
     FROM (
       SELECT so.so_nomor, so.so_pen_nomor, so.so_pen_id
       FROM tsalesorder so WHERE so.so_aktif = 'Y'
       UNION ALL
       SELECT s.spk_nomor, s.spk_pen_nomor, s.spk_pen_id
       FROM tspk s WHERE s.spk_is_so = 1 AND s.spk_aktif = 'Y'
     ) resolved
     INNER JOIN tpenawaran_dtl pd
       ON pd.pend_pen_nomor = resolved.so_pen_nomor
       AND pd.pend_id = resolved.so_pen_id
     WHERE pd.pend_minta = ?
     UNION
     SELECT DISTINCT so2.so_nomor AS SoNomor
     FROM tpenawaran_dtl pd2
     INNER JOIN tmemospk mp2 ON mp2.mspk_pen_nomor = pd2.pend_pen_nomor AND mp2.mspk_pen_id = pd2.pend_id
     INNER JOIN tsalesorder so2 ON so2.so_memo = mp2.mspk_nomor AND so2.so_aktif = 'Y'
     WHERE pd2.pend_minta = ?`,
        [row.pjwd_mh_nomor, row.pjwd_mh_nomor],
      );
      soList = found.map((r) => r.SoNomor);
    } else if (row.pjwd_pen_nomor && row.pjwd_pen_id) {
      // Cek SO/SPK langsung dulu
      const [foundDirect] = await db.query(
        `SELECT so_nomor AS SoNomor FROM tsalesorder
     WHERE so_pen_nomor = ? AND so_pen_id = ? AND so_aktif = 'Y'
     UNION ALL
     SELECT spk_nomor AS SoNomor FROM tspk
     WHERE spk_pen_nomor = ? AND spk_pen_id = ? AND spk_is_so = 1 AND spk_aktif = 'Y'`,
        [
          row.pjwd_pen_nomor,
          row.pjwd_pen_id,
          row.pjwd_pen_nomor,
          row.pjwd_pen_id,
        ],
      );
      if (foundDirect.length > 0) {
        soList = foundDirect.map((r) => r.SoNomor);
      } else {
        // Belum jadi SO langsung — cek apakah udah jadi MAP dulu, lalu
        // cek apakah MAP itu udah jadi SO
        const [[mapRow]] = await db.query(
          `SELECT mspk_nomor FROM tmemospk WHERE mspk_pen_nomor = ? AND mspk_pen_id = ? LIMIT 1`,
          [row.pjwd_pen_nomor, row.pjwd_pen_id],
        );
        if (mapRow) {
          const [foundViaMap] = await db.query(
            `SELECT so_nomor AS SoNomor FROM tsalesorder WHERE so_memo = ? AND so_aktif = 'Y'`,
            [mapRow.mspk_nomor],
          );
          soList = foundViaMap.map((r) => r.SoNomor);
          // Kalau MAP-nya ketemu tapi belum jadi SO, "naikkan" baris ini
          // jadi MAP (bukan Penawaran lagi) — supaya Sumber-nya akurat
          if (soList.length === 0) {
            await db.query(
              `UPDATE tpenjadwalan_ppic_dtl SET pjwd_map_nomor = ? WHERE pjwd_id = ?`,
              [mapRow.mspk_nomor, row.pjwd_id],
            );
            continue; // lanjut ke row berikutnya, belum ada SO utk baris ini
          }
        }
      }
    }

    if (soList.length === 0) continue; // belum jadi SO, biarkan tetap MH/PENAWARAN

    // Baris pertama: update baris existing
    await db.query(
      `UPDATE tpenjadwalan_ppic_dtl SET pjwd_so_nomor = ? WHERE pjwd_id = ?`,
      [soList[0], row.pjwd_id],
    );

    // Sisanya (kalau pecah jadi >1 SO): insert baris BARU, salin
    // pjwd_mh_nomor/pjwd_pen_nomor asal untuk jejak asal-usul, tapi
    // dengan pjwd_so_nomor masing-masing yang berbeda.
    for (let i = 1; i < soList.length; i++) {
      await db.query(
        `INSERT INTO tpenjadwalan_ppic_dtl
           (pjwd_pjw_nomor, pjwd_so_nomor, pjwd_mh_nomor, pjwd_pen_nomor, pjwd_pen_id,
            pjwd_rencana, pjwd_status_permintaan)
         VALUES (?, ?, ?, ?, ?, 0, 'CLOSE')`,
        [
          pjwNomor,
          soList[i],
          row.pjwd_mh_nomor,
          row.pjwd_pen_nomor,
          row.pjwd_pen_id,
        ],
      );
    }
  }
};

// ── Load untuk mode edit ── (tidak berubah, tetap panggil getDetail dari service browse)
const getFormDetail = async (nomor) => {
  const [hdrRows] = await db.query(
    `SELECT h.pjw_nomor, DATE_FORMAT(h.pjw_tgl1, '%Y-%m-%d') AS pjw_tgl1,
          DATE_FORMAT(h.pjw_tgl2, '%Y-%m-%d') AS pjw_tgl2,
          h.pjw_cab, h.pjw_divisi, h.pjw_keterangan, h.pjw_close
     FROM tpenjadwalan_ppic_hdr h WHERE h.pjw_nomor = ?`,
    [nomor],
  );
  if (!hdrRows.length) return null;

  await resolveSourceForPeriod(nomor);

  const detail = await getDetail(nomor);
  return { header: hdrRows[0], detail };
};

// ── Save — sekarang so_nomor boleh kosong asal pro_nomor ada ──
const saveData = async (payload, userKode, userBagian) => {
  const {
    pjw_nomor,
    pjw_tgl1,
    pjw_tgl2,
    pjw_cab,
    pjw_divisi,
    pjw_keterangan,
    detail = [],
  } = payload;

  if (!pjw_tgl1 || !pjw_tgl2) throw new Error("Periode wajib diisi.");
  if (!detail.length)
    throw new Error("Minimal satu SO/Pra Order/MAP harus ditambahkan.");

  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  const isPpic = !isAdmin && bagianUpper === "PPIC";
  const isMarketing = !isAdmin && bagianUpper === "MARKETING";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const tahun = new Date(pjw_tgl1).getFullYear();
    let nomor = pjw_nomor;

    let existingByKey = {};
    if (nomor) {
      const [oldRows] = await conn.query(
        `SELECT pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor,
                pjwd_rencana, pjwd_tgl_permintaan_kirim, pjwd_status_permintaan,
                pjwd_tgl_kesepakatan, pjwd_ket_kesepakatan
         FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`,
        [nomor],
      );
      for (const r of oldRows) {
        const key = r.pjwd_so_nomor || r.pjwd_pro_nomor || r.pjwd_map_nomor;
        existingByKey[key] = r;
      }
    }

    if (nomor) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_hdr SET
           pjw_tgl1 = ?, pjw_tgl2 = ?, pjw_cab = ?, pjw_divisi = ?, pjw_keterangan = ?,
           user_modified = ?, date_modified = NOW()
         WHERE pjw_nomor = ?`,
        [
          pjw_tgl1,
          pjw_tgl2,
          pjw_cab || "",
          pjw_divisi || null,
          pjw_keterangan || "",
          userKode,
          nomor,
        ],
      );
    } else {
      nomor = await generateNomor(tahun);
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          nomor,
          pjw_tgl1,
          pjw_tgl2,
          pjw_cab || "",
          pjw_divisi || null,
          pjw_keterangan || "",
          userKode,
        ],
      );
    }

    await conn.query(
      `DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ?`,
      [nomor],
    );

    for (const row of detail) {
      if (!row.SoNomor && !row.NomorPraOrder && !row.MapNomor) continue;

      const key = row.SoNomor || row.NomorPraOrder || row.MapNomor;
      const old = existingByKey[key];

      let rencana = Number(row.Rencana) || 0;
      let permintaanKirim = row.PermintaanKirim || null;
      let statusPermintaan = row.StatusPermintaan || "CLOSE";
      let kesepakatan = row.Kesepakatan || null;
      let ketKesepakatan = row.KetKesepakatan || "";

      if (isPpic) {
        rencana = old ? old.pjwd_rencana : rencana;
        permintaanKirim = old ? old.pjwd_tgl_permintaan_kirim : permintaanKirim;
        statusPermintaan = old ? old.pjwd_status_permintaan : statusPermintaan;
      } else if (isMarketing) {
        kesepakatan = old ? old.pjwd_tgl_kesepakatan : kesepakatan;
        ketKesepakatan = old ? old.pjwd_ket_kesepakatan : ketKesepakatan;
      }

      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_dtl
           (pjwd_pjw_nomor, pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor, pjwd_rencana,
            pjwd_tgl_permintaan_kirim, pjwd_status_permintaan,
            pjwd_tgl_kesepakatan, pjwd_ket_kesepakatan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nomor,
          row.SoNomor || null,
          row.NomorPraOrder || null,
          row.MapNomor || null,
          rencana,
          permintaanKirim,
          statusPermintaan,
          kesepakatan,
          ketKesepakatan,
        ],
      );
    }

    await conn.commit();
    return { nomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ═══════════════════════════════════════════════════════════
// GRANULAR ROW-LEVEL OPERATIONS — untuk realtime auto-save
// Menggantikan pola delete-lalu-insert-ulang saveData() lama.
// Setiap operasi langsung commit ke DB satu unit kerja saja.
// ═══════════════════════════════════════════════════════════

const FIELD_OWNERSHIP = {
  pjwd_rencana: "MARKETING",
  pjwd_ket_rencana: "MARKETING",
  pjwd_tgl_permintaan_kirim: "MARKETING",
  pjwd_status_permintaan: "MARKETING",
  pjwd_tgl_kesepakatan: "NOT_MARKETING", // ⬅ diubah dari "PPIC"
  pjwd_ket_kesepakatan: "NOT_MARKETING", // ⬅ diubah dari "PPIC"
  pjwd_nama_manual: "MARKETING",
  pjwd_pesan_manual: "MARKETING",
  pjwd_kirim_manual: "MARKETING",
  pjwd_realisasi_manual: "MARKETING",
};

const HEADER_FIELD_OWNERSHIP = {
  pjw_tgl1: "MARKETING",
  pjw_tgl2: "MARKETING",
  pjw_cab: "MARKETING",
  pjw_divisi: "MARKETING",
  pjw_keterangan: "MARKETING",
};

const assertFieldOwnership = (field, ownershipMap, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  if (isAdmin) return;

  const owner = ownershipMap[field];
  if (!owner) return;

  const bagianUpper = (userBagian || "").toUpperCase();

  if (owner === "NOT_MARKETING") {
    if (bagianUpper === "MARKETING") {
      throw new Error("Field ini tidak bisa diubah oleh bagian Marketing.");
    }
    return;
  }

  // AUDIT diberi akses sama seperti MARKETING untuk field-field ini
  // (Rencana, Ket Rencana, Permintaan Kirim, dst) — permintaan khusus.
  if (owner === "MARKETING" && bagianUpper === "AUDIT") return;

  if (bagianUpper !== owner) {
    throw new Error(`Field ini hanya bisa diubah oleh bagian ${owner}.`);
  }
};

// ── UPDATE HEADER — satu field per call (Periode/Cabang/Keterangan) ──
const updateHeaderField = async (
  pjwNomor,
  field,
  value,
  userKode,
  userBagian,
) => {
  if (!Object.prototype.hasOwnProperty.call(HEADER_FIELD_OWNERSHIP, field)) {
    throw new Error("Field header tidak dikenal.");
  }
  assertFieldOwnership(field, HEADER_FIELD_OWNERSHIP, userKode, userBagian);

  await db.query(
    `UPDATE tpenjadwalan_ppic_hdr SET ${field} = ?, user_modified = ?, date_modified = NOW() WHERE pjw_nomor = ?`,
    [value, userKode, pjwNomor],
  );
  return { pjw_nomor: pjwNomor, field, value };
};

// ── CREATE HEADER (baru — sebelumnya bagian dari saveData()) ──
const createHeader = async (payload, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING" && bagianUpper !== "AUDIT") {
    throw new Error(
      "Membuat Komitmen Kirim baru hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }

  const { pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan } = payload;
  if (!pjw_tgl1 || !pjw_tgl2) throw new Error("Periode wajib diisi.");

  const tahun = new Date(pjw_tgl1).getFullYear();
  const nomor = await generateNomor(tahun);

  await db.query(
    `INSERT INTO tpenjadwalan_ppic_hdr
       (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      nomor,
      pjw_tgl1,
      pjw_tgl2,
      pjw_cab || "",
      pjw_divisi || null,
      pjw_keterangan || "",
      userKode,
    ],
  );
  return { nomor };
};

// ── Helper: total Rencana SAAT INI untuk satu periode, opsional exclude
// satu baris (dipakai saat update baris itu sendiri, supaya tidak
// menghitung nilai lamanya dobel dengan nilai barunya).
const getTotalRencana = async (pjwNomor, excludePjwdId = null, tipe = "SO") => {
  let query = `SELECT IFNULL(SUM(pjwd_rencana), 0) AS total FROM tpenjadwalan_ppic_dtl WHERE pjwd_pjw_nomor = ? AND pjwd_tipe = ?`;
  const params = [pjwNomor, tipe];
  if (excludePjwdId) {
    query += ` AND pjwd_id <> ?`;
    params.push(excludePjwdId);
  }
  const [[row]] = await db.query(query, params);
  return Number(row.total) || 0;
};

// Kapasitas kirim mingguan per cabang. Cabang yang tidak terdaftar
// pakai DEFAULT_CAPACITY.
const CABANG_CAPACITY = {
  P01: 75000,
  P04: 15000,
};
const DEFAULT_CAPACITY = 15000;

const getCapacity = (cabang) => CABANG_CAPACITY[cabang] || DEFAULT_CAPACITY;

// ── ADD DETAIL ROW — satu baris SO/Pra Order/MAP ──
const addDetailRow = async (pjwNomor, rowData, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING" && bagianUpper !== "AUDIT") {
    throw new Error(
      "Menambah baris hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }
  const {
    Tipe,
    SoNomor,
    NomorPraOrder,
    MapNomor,
    MhNomor,
    PenNomor,
    PenId,
    Rencana,
    Realisasi,
    Pesan,
    Kirim,
    PermintaanKirim,
    NamaManual,
    PesanManual,
    KirimManual,
    RealisasiManual,
  } = rowData;
  const tipe = Tipe === "MAP" ? "MAP" : "SO";
  const isManual =
    !SoNomor && !NomorPraOrder && !MapNomor && !MhNomor && !PenNomor;
  if (isManual && !NamaManual) {
    throw new Error("Baris manual harus punya Nama.");
  }

  // Untuk tab MAP: Rencana otomatis = Pesan (qty penuh), bukan diisi
  // manual — beda dari keputusan awal ("qty sampel manual"), diganti
  // sesuai arahan terbaru: Rencana=Pesan berarti Close otomatis.
  const rencanaVal = tipe === "MAP" ? Number(Pesan) || 0 : Number(Rencana) || 0;
  const realisasiVal =
    tipe === "MAP" && !isManual ? Number(Realisasi) || 0 : null;
  // Pesan/Kirim untuk MAP: snapshot mspk_jumlah/qty kirim SJ dari
  // getMapInfo saat baris ditarik — sebelumnya salah dihardcode 0,
  // sekarang ambil dari nilai yang dikirim frontend.
  const pesanVal = tipe === "MAP" && !isManual ? Number(Pesan) || 0 : null;
  const kirimVal = tipe === "MAP" && !isManual ? Number(Kirim) || 0 : null;

  const [[hdrRow]] = await db.query(
    `SELECT pjw_cab FROM tpenjadwalan_ppic_hdr WHERE pjw_nomor = ?`,
    [pjwNomor],
  );
  const batasKapasitas = getCapacity(hdrRow?.pjw_cab);

  const totalSekarang = await getTotalRencana(pjwNomor, null, tipe);
  const totalSetelah = totalSekarang + rencanaVal;
  const melebihiBatas = tipe === "SO" && totalSetelah > batasKapasitas;
  const permintaanKirimSafe = PermintaanKirim
    ? String(PermintaanKirim).substring(0, 10)
    : null;
  const [result] = await db.query(
    `INSERT INTO tpenjadwalan_ppic_dtl
       (pjwd_pjw_nomor, pjwd_tipe, pjwd_so_nomor, pjwd_pro_nomor, pjwd_map_nomor, pjwd_mh_nomor, pjwd_pen_nomor, pjwd_pen_id, pjwd_rencana,
        pjwd_tgl_permintaan_kirim, pjwd_status_permintaan, pjwd_user_create,
        pjwd_nama_manual, pjwd_pesan_manual, pjwd_kirim_manual, pjwd_realisasi_manual)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLOSE', ?, ?, ?, ?, ?)`,
    [
      pjwNomor,
      tipe,
      SoNomor || null,
      NomorPraOrder || null,
      MapNomor || null,
      MhNomor || null,
      PenNomor || null,
      PenId || null,
      rencanaVal,
      permintaanKirimSafe,
      userKode,
      isManual ? NamaManual : null,
      isManual ? Number(PesanManual) || 0 : pesanVal,
      isManual ? Number(KirimManual) || 0 : kirimVal,
      isManual ? Number(RealisasiManual) || 0 : realisasiVal,
    ],
  );
  return {
    pjwd_id: result.insertId,
    warning: melebihiBatas ? { totalSetelah, batas: batasKapasitas } : null,
  };
};

// ── UPDATE DETAIL FIELD — satu kolom di satu baris ──
const DATE_FIELDS = ["pjwd_tgl_permintaan_kirim", "pjwd_tgl_kesepakatan"];

const updateDetailField = async (
  pjwdId,
  field,
  value,
  userKode,
  userBagian,
) => {
  if (!Object.prototype.hasOwnProperty.call(FIELD_OWNERSHIP, field)) {
    throw new Error("Field detail tidak dikenal.");
  }
  assertFieldOwnership(field, FIELD_OWNERSHIP, userKode, userBagian);

  // Nomor periode pemilik baris — dibutuhkan controller untuk emit socket
  // ke room yang tepat (frontend tidak mengirim pjwNomor).
  const [[ownRow]] = await db.query(
    `SELECT pjwd_pjw_nomor FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`,
    [pjwdId],
  );
  if (!ownRow) throw new Error("Baris tidak ditemukan.");

  let sanitizedValue = value;
  if (DATE_FIELDS.includes(field) && (value === "" || value === undefined)) {
    sanitizedValue = null;
  }

  let melebihiBatas = false;
  let totalSetelah = null;
  let batasKapasitas = null;

  if (field === "pjwd_rencana") {
    const [[row]] = await db.query(
      `SELECT d.pjwd_pjw_nomor, d.pjwd_tipe, h.pjw_cab
       FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       WHERE d.pjwd_id = ?`,
      [pjwdId],
    );
    if (!row) throw new Error("Baris tidak ditemukan.");

    if (row.pjwd_tipe === "SO") {
      batasKapasitas = getCapacity(row.pjw_cab);
      const rencanaBaru = Number(value) || 0;
      const totalLain = await getTotalRencana(row.pjwd_pjw_nomor, pjwdId, "SO");
      totalSetelah = totalLain + rencanaBaru;
      melebihiBatas = totalSetelah > batasKapasitas;
    }
  }

  await db.query(
    `UPDATE tpenjadwalan_ppic_dtl SET ${field} = ? WHERE pjwd_id = ?`,
    [sanitizedValue, pjwdId],
  );
  return {
    pjwd_id: Number(pjwdId),
    pjw_nomor: ownRow.pjwd_pjw_nomor,
    field,
    value: sanitizedValue,
    warning: melebihiBatas ? { totalSetelah, batas: batasKapasitas } : null,
  };
};

// ── DELETE DETAIL ROW ──
const deleteDetailRow = async (pjwdId, userKode, userBagian) => {
  const isAdmin = (userKode || "").toUpperCase() === "ADMIN";
  const bagianUpper = (userBagian || "").toUpperCase();
  if (!isAdmin && bagianUpper !== "MARKETING" && bagianUpper !== "AUDIT") {
    throw new Error(
      "Menghapus baris hanya bisa dilakukan oleh bagian MARKETING.",
    );
  }
  const [[ownRow]] = await db.query(
    `SELECT pjwd_pjw_nomor FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`,
    [pjwdId],
  );
  if (!ownRow) throw new Error("Baris tidak ditemukan.");
  await db.query(`DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`, [
    pjwdId,
  ]);
  return { pjwd_id: Number(pjwdId), pjw_nomor: ownRow.pjwd_pjw_nomor }; // ⬅ cast ke Number
};

// ═══════════════════════════════════════════════════════════
// PINDAH PERIODE OTOMATIS — saat Kesepakatan mundur/maju ke
// minggu lain. Dua tahap: cek target (utk dialog konfirmasi),
// lalu eksekusi (transaksional).
// ═══════════════════════════════════════════════════════════

const getMondayOfWeek = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon;
};
const toLocalDate = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const getWeekRange = (tanggal) => {
  const monday = getMondayOfWeek(tanggal);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { tgl1: toLocalDate(monday), tgl2: toLocalDate(saturday) };
};

// ── CEK TARGET (dipanggil saat blur, SEBELUM pindah beneran) ──
const checkTargetPeriod = async (pjwdId, tanggalBaru) => {
  const [[row]] = await db.query(
    `SELECT d.pjwd_so_nomor, d.pjwd_pro_nomor, d.pjwd_map_nomor,
            h.pjw_tgl1, h.pjw_tgl2, h.pjw_cab
     FROM tpenjadwalan_ppic_dtl d
     INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
     WHERE d.pjwd_id = ?`,
    [pjwdId],
  );
  if (!row) throw new Error("Baris tidak ditemukan.");

  if (tanggalBaru >= row.pjw_tgl1 && tanggalBaru <= row.pjw_tgl2) {
    return { needMove: false };
  }

  const arah = tanggalBaru < row.pjw_tgl1 ? "MAJU" : "MUNDUR";

  const { tgl1, tgl2 } = getWeekRange(tanggalBaru);
  const [[target]] = await db.query(
    `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
     WHERE pjw_cab = ? AND pjw_close = 'N' AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
     LIMIT 1`,
    [row.pjw_cab, tanggalBaru],
  );

  return {
    needMove: true,
    arah,
    willCreateNew: !target,
    targetNomor: target ? target.pjw_nomor : null,
    targetTgl1: tgl1,
    targetTgl2: tgl2,
  };
};

// ── EKSEKUSI PINDAH (dipanggil setelah PPIC konfirmasi dialog) ──
const moveDetailRowToPeriod = async (
  pjwdId,
  tanggalBaru,
  userKode,
  userBagian,
) => {
  assertFieldOwnership(
    "pjwd_tgl_kesepakatan",
    FIELD_OWNERSHIP,
    userKode,
    userBagian,
  );

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[row]] = await conn.query(
      `SELECT d.pjwd_pjw_nomor, d.pjwd_so_nomor, d.pjwd_pro_nomor, d.pjwd_map_nomor, d.pjwd_rencana,
              h.pjw_cab, h.pjw_divisi, h.pjw_tgl1, h.pjw_tgl2
       FROM tpenjadwalan_ppic_dtl d
       INNER JOIN tpenjadwalan_ppic_hdr h ON h.pjw_nomor = d.pjwd_pjw_nomor
       WHERE d.pjwd_id = ? FOR UPDATE`,
      [pjwdId],
    );
    if (!row) throw new Error("Baris tidak ditemukan.");

    if (tanggalBaru >= row.pjw_tgl1 && tanggalBaru <= row.pjw_tgl2) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_dtl SET pjwd_tgl_kesepakatan = ? WHERE pjwd_id = ?`,
        [tanggalBaru, pjwdId],
      );
      await conn.commit();
      return {
        moved: false,
        nomor: row.pjwd_pjw_nomor,
        pjwd_id: Number(pjwdId),
      };
    }

    const arah = tanggalBaru < row.pjw_tgl1 ? "MAJU" : "MUNDUR";

    const { tgl1, tgl2 } = getWeekRange(tanggalBaru);
    const [[target]] = await conn.query(
      `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
       WHERE pjw_cab = ? AND pjw_close = 'N' AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
       LIMIT 1 FOR UPDATE`,
      [row.pjw_cab, tanggalBaru],
    );

    const key = row.pjwd_so_nomor || row.pjwd_pro_nomor || row.pjwd_map_nomor;
    let targetNomor;

    if (target) {
      targetNomor = target.pjw_nomor;
    } else {
      targetNomor = await generateNomor(new Date(tgl1).getFullYear());
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, '', ?, NOW())`,
        [targetNomor, tgl1, tgl2, row.pjw_cab, row.pjw_divisi, userKode],
      );
    }

    // BARU: cek apakah SO/PraOrder/MAP yang sama sudah ada baris lain
    // di periode tujuan (mis. hasil split PARTIAL sebelumnya). Kalau
    // ada — digabung (merge Rencana), bukan pindah-tabrak (yang akan
    // kena UNIQUE KEY constraint uq_pjwd_so).
    let merged = false;
    let mergedIntoId = null;
    if (key && target) {
      const identifierCol = row.pjwd_so_nomor
        ? "pjwd_so_nomor"
        : row.pjwd_pro_nomor
          ? "pjwd_pro_nomor"
          : "pjwd_map_nomor";

      const [[existingTarget]] = await conn.query(
        `SELECT pjwd_id, pjwd_rencana FROM tpenjadwalan_ppic_dtl
         WHERE pjwd_pjw_nomor = ? AND ${identifierCol} = ?
         LIMIT 1 FOR UPDATE`,
        [targetNomor, key],
      );

      if (existingTarget) {
        // Gabung: tambahkan Rencana baris yang dipindah ke baris tujuan
        // yang sudah ada. Field lain (Permintaan Kirim, Kesepakatan,
        // dll) TETAP milik baris tujuan lama — tidak ditimpa.
        await conn.query(
          `UPDATE tpenjadwalan_ppic_dtl SET pjwd_rencana = pjwd_rencana + ? WHERE pjwd_id = ?`,
          [Number(row.pjwd_rencana) || 0, existingTarget.pjwd_id],
        );
        await conn.query(
          `DELETE FROM tpenjadwalan_ppic_dtl WHERE pjwd_id = ?`,
          [pjwdId],
        );
        merged = true;
        mergedIntoId = Number(existingTarget.pjwd_id);
      }
    }

    if (!merged) {
      await conn.query(
        `UPDATE tpenjadwalan_ppic_dtl SET pjwd_pjw_nomor = ?, pjwd_tgl_kesepakatan = ? WHERE pjwd_id = ?`,
        [targetNomor, tanggalBaru, pjwdId],
      );
    }

    // Kalau MAJU, kredit sebagai Tambahan di Pencapaian periode tujuan
    // — produksi menyelesaikan pekerjaan periode depan lebih cepat.
    if (arah === "MAJU") {
      await conn.query(
        `INSERT INTO tpenjadwalan_ppic_pencapaian
           (pjwp_pjw_nomor, pjwp_tipe, pjwp_kategori, pjwp_keterangan, pjwp_pcs, pjwp_urutan)
         VALUES (?, 'TAMBAHAN', 'Produksi', ?, ?, 0)`,
        [
          targetNomor,
          `Maju dari periode ${row.pjwd_pjw_nomor} (${key || "-"})${merged ? " — digabung" : ""}`,
          Number(row.pjwd_rencana) || 0,
        ],
      );
    }

    await conn.commit();
    return {
      moved: true,
      merged,
      mergedIntoId,
      arah,
      fromNomor: row.pjwd_pjw_nomor,
      nomor: targetNomor,
      pjwd_id: Number(pjwdId),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ── Cabang yang didukung modul Komitmen Kirim (sama seperti getCabangOptions) ──
const KOMITMEN_KIRIM_CABANG = ["P01", "P02", "P04", "P05"];

// ── Auto-push MAP yang baru di-approve CMO ke Komitmen Kirim MAP/Sampel ──
// Dipanggil dari approveCmo dan save (Form, saat Cmo terisi).
// Best-effort & idempotent — kegagalan di sini TIDAK boleh menggagalkan
// approve/save MAP itu sendiri.
// Adaptasi dari Manksi: DB MMT tidak punya kolom mspk_tgl_cmo &
// mspk_dateline, maka jangkar minggu = tanggal approve (hari ini,
// via anchorDate) dan tanggal permintaan kirim = NULL.
const pushMapToKomitmenKirim = async (
  mapNomor,
  userKode = "SYSTEM",
  anchorDate = null,
) => {
  try {
    const [[map]] = await db.query(
      `SELECT mspk_nomor, mspk_nama, mspk_cab, mspk_divisi, mspk_jumlah,
              mspk_referensi
       FROM tmemospk WHERE mspk_nomor = ? AND mspk_aktif = 'Y'`,
      [mapNomor],
    );
    if (!map) return;

    const cab = map.mspk_cab || "";
    if (!KOMITMEN_KIRIM_CABANG.includes(cab)) return;

    const [[existing]] = await db.query(
      `SELECT pjwd_id FROM tpenjadwalan_ppic_dtl WHERE pjwd_map_nomor = ? AND pjwd_tipe = 'MAP' LIMIT 1`,
      [mapNomor],
    );
    if (existing) return;

    // MAP revisi: arahkan baris MAP asal ke MAP revisi ini. Rencana,
    // Permintaan Kirim & Kesepakatan tetap.
    if (map.mspk_referensi) {
      await db.query(
        `UPDATE tpenjadwalan_ppic_dtl
         SET pjwd_map_nomor = ?,
             pjwd_pesan_manual = IF(pjwd_tipe = 'MAP', ?, pjwd_pesan_manual)
         WHERE pjwd_map_nomor = ?`,
        [mapNomor, Number(map.mspk_jumlah) || 0, map.mspk_referensi],
      );
      const [[sudahAda]] = await db.query(
        `SELECT pjwd_id FROM tpenjadwalan_ppic_dtl
         WHERE pjwd_map_nomor = ? AND pjwd_tipe = 'MAP' LIMIT 1`,
        [mapNomor],
      );
      if (sudahAda) return;
    }

    const anchor = anchorDate || toLocalDate(new Date());
    const [[periode]] = await db.query(
      `SELECT pjw_nomor FROM tpenjadwalan_ppic_hdr
       WHERE pjw_cab = ? AND ? BETWEEN pjw_tgl1 AND pjw_tgl2
       ORDER BY pjw_tgl1 DESC LIMIT 1`,
      [cab, anchor],
    );

    let pjwNomor;
    if (periode) {
      pjwNomor = periode.pjw_nomor;
    } else {
      const { tgl1, tgl2 } = getWeekRange(anchor);
      pjwNomor = await generateNomor(new Date(tgl1).getFullYear());
      await db.query(
        `INSERT INTO tpenjadwalan_ppic_hdr
           (pjw_nomor, pjw_tgl1, pjw_tgl2, pjw_cab, pjw_divisi, pjw_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, '', ?, NOW())`,
        [pjwNomor, tgl1, tgl2, cab, map.mspk_divisi || null, userKode],
      );
    }

    await db.query(
      `INSERT INTO tpenjadwalan_ppic_dtl
         (pjwd_pjw_nomor, pjwd_tipe, pjwd_map_nomor, pjwd_rencana,
          pjwd_tgl_permintaan_kirim, pjwd_status_permintaan, pjwd_user_create,
          pjwd_pesan_manual, pjwd_kirim_manual)
       VALUES (?, 'MAP', ?, ?, NULL, 'CLOSE', ?, ?, 0)`,
      [
        pjwNomor,
        mapNomor,
        Number(map.mspk_jumlah) || 0,
        userKode,
        Number(map.mspk_jumlah) || 0,
      ],
    );
  } catch (e) {
    console.error(`Gagal auto-push MAP ${mapNomor} ke Komitmen Kirim:`, e);
  }
};

// ── Hapus baris Komitmen Kirim MAP terkait — dipanggil saat MAP
// dihapus, dinonaktifkan (revisi/pending NOPO), atau batal approve
// CMO. Best-effort, tidak boleh menggagalkan aksi utamanya.
// Baris yang Rencana-nya sudah diisi user (>0) TIDAK dihapus otomatis
// — itu tanda PPIC/Marketing sudah mulai kerjakan, hapus manual saja
// supaya tidak kehilangan data kerja mereka tanpa sadar.
const removeMapFromKomitmenKirim = async (mapNomor) => {
  try {
    await db.query(
      `DELETE FROM tpenjadwalan_ppic_dtl
       WHERE pjwd_map_nomor = ? AND pjwd_tipe = 'MAP' AND pjwd_rencana = 0`,
      [mapNomor],
    );
  } catch (e) {
    console.error(`Gagal hapus MAP ${mapNomor} dari Komitmen Kirim:`, e);
  }
};

module.exports = {
  generateNomor,
  getCabangOptions,
  getDivisiOptions,
  searchSoKandidat,
  searchPraOrderKandidat,
  searchMapKandidat,
  getSoInfo,
  getMapInfo,
  getMhInfo,
  getPenawaranDetailList,
  getPenawaranItemInfo,
  getFormDetail,
  saveData,
  updateHeaderField,
  createHeader,
  addDetailRow,
  updateDetailField,
  deleteDetailRow,
  checkTargetPeriod,
  moveDetailRowToPeriod,
  pushMapToKomitmenKirim,
  removeMapFromKomitmenKirim,
  getBrowse,
  getDetail,
  toggleClose,
  deleteData,
  getPencapaian,
  savePencapaian,
  getUnnotifiedMap,
  markMapNotified,
};
