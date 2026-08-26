const db = require("../../config/database");

// ============================================================
// MKA — Memo Kebutuhan Aksesoris (Garmen)
// Header : tmka_hdr  (prefix kolom: mkb_)
// Detail : tmka_dtl  (prefix kolom: mkbd_)
// Master : tgarmen_brg (brg_jenis='ACCESORIES')
// Stok   : tmasterstok_acc
// Realisasi: tgarmenrealisasi_hdr + tgarmenrealisasi_dtl
// ============================================================

// --- BROWSE (master list) ---
const getBrowseList = async (filters) => {
  const { startDate, endDate, kodeBarang, filterByTglSpk } = filters;
  const byTglSpk = filterByTglSpk === true || filterByTglSpk === "true";
  const q = (kodeBarang || "").trim();

  if (byTglSpk) {
    // ── Mode: filter berdasarkan TANGGAL SPK (replikasi ckTglSpk.Checked
    // Delphi). Basis-nya tspk, LEFT JOIN ke tmka_hdr — SPK yang belum
    // pernah dibuatkan MKA sama sekali tetap muncul (baris merah di FE),
    // selama tanggal SPK-nya masuk rentang filter.
    let params = [startDate, endDate];
    let extraWhere = "";
    if (q !== "") {
      extraWhere = ` AND EXISTS (
        SELECT 1 FROM tmka_dtl d2
        WHERE d2.mkbd_nomor = h.mkb_nomor AND d2.mkbd_brg_kode LIKE ?
      )`;
      params.push(`%${q}%`);
    }
    const [rows] = await db.query(
      `SELECT
        IFNULL(h.mkb_nomor, '') AS Nomor,
        s.spk_tanggal      AS Tanggal,
        IFNULL(v.divisi, '') AS Divisi,
        s.spk_nomor        AS SPK,
        s.spk_nama         AS NamaSpk,
        s.spk_jumlah       AS JumlahSPK,
        0                  AS JumlahAksesoris,
        0                  AS JumlahBelumSiap,
        IF(s.spk_close = 0, 'OPEN', 'CLOSE') AS StatusSpk,
        -- Mode ini tidak menghitung agregasi kesiapan (biar query tetap
        -- ringan, mengikuti pola Delphi ckTglSpk yang juga tidak menghitung
        -- ini) — kalau perlu kesiapan akurat di mode ini juga, kasih tahu,
        -- bisa ditambahkan JOIN agregasi yang sama seperti mode default.
        IF(h.mkb_nomor IS NULL, NULL, 'OPEN') AS StatusMka,
        IFNULL(h.mkb_note, '') AS Keterangan,
        IFNULL(h.user_create, '') AS UserCreate,
        h.date_create      AS Created,
        IF(h.mkb_nomor IS NULL, 'SPK', 'MKA') AS RowType
       FROM tspk s
       LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
       LEFT JOIN tmka_hdr h ON h.mkb_spk_nomor = s.spk_nomor
       WHERE s.spk_divisi IN (3, 4, 6)
         AND s.spk_aktif = 'Y'
         AND s.spk_tanggal >= ? AND s.spk_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
         ${extraWhere}
       ORDER BY s.spk_tanggal ASC, s.spk_nomor ASC`,
      params,
    );
    return rows;
  }

  // ── Mode default: filter berdasarkan TANGGAL MKA ──
  let paramsMKA = [startDate, endDate];
  let extraWhereMKA = "";
  let paramsSPK = [startDate, endDate];
  let extraWhereSPK = "";
  if (q !== "") {
    extraWhereMKA = ` AND (
      EXISTS (
        SELECT 1 FROM tmka_dtl d2
        WHERE d2.mkbd_nomor = h.mkb_nomor
          AND d2.mkbd_brg_kode LIKE ?
      )
      OR h.mkb_spk_nomor LIKE ?
    )`;
    paramsMKA.push(`%${q}%`, `%${q}%`);
    extraWhereSPK = ` AND (s.spk_nomor LIKE ? OR s.spk_nama LIKE ?)`;
    paramsSPK.push(`%${q}%`, `%${q}%`);
  }
  const [rows] = await db.query(
    `SELECT * FROM (
        SELECT
          h.mkb_nomor        AS Nomor,
          h.mkb_tanggal      AS Tanggal,
          IFNULL(v.divisi, '') AS Divisi,
          h.mkb_spk_nomor    AS SPK,
          IFNULL(s.spk_nama, '') AS NamaSpk,
          IFNULL(s.spk_jumlah, 0) AS JumlahSPK,
          IFNULL(agg.TotalKode, 0)      AS JumlahAksesoris,
          IFNULL(agg.BelumSiapCount, 0) AS JumlahBelumSiap,
          -- [BARU] Status SPK — SELALU status close produksi, konsisten di
          -- semua baris (baik RowType MKA maupun SPK)
          IF(IFNULL(s.spk_close, 0) = 0, 'OPEN', 'CLOSE') AS StatusSpk,
          -- [BARU] Status MKA — status kesiapan aksesoris dari Gudang,
          -- HANYA relevan untuk baris MKA
          IF(
            IFNULL(agg.TotalKode, 0) > 0 AND IFNULL(agg.BelumSiapCount, 0) = 0,
            'CLOSE', 'OPEN'
          ) AS StatusMka,
          h.mkb_note         AS Keterangan,
          h.user_create      AS UserCreate,
          h.date_create      AS Created,
          'MKA'              AS RowType
        FROM tmka_hdr h
        LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor
        LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
        LEFT JOIN (
          SELECT
            g.Nomor,
            COUNT(*) AS TotalKode,
            SUM(CASE WHEN g.TotalDiminta > IFNULL(r.TotalRealisasi, 0) THEN 1 ELSE 0 END) AS BelumSiapCount
          FROM (
            SELECT dd.mkbd_nomor AS Nomor, dd.mkbd_brg_kode AS Kode, SUM(dd.mkbd_jumlah) AS TotalDiminta
            FROM tmka_dtl dd
            GROUP BY dd.mkbd_nomor, dd.mkbd_brg_kode
          ) g
          LEFT JOIN tmka_hdr hh ON hh.mkb_nomor = g.Nomor
          LEFT JOIN (
            SELECT j.re_spk_nomor AS SpkNomor, i.red_brg_kode AS Kode, SUM(i.red_jumlah) AS TotalRealisasi
            FROM tgarmenrealisasi_hdr j
            INNER JOIN tgarmenrealisasi_dtl i ON i.red_nomor = j.re_nomor
            GROUP BY j.re_spk_nomor, i.red_brg_kode
          ) r ON r.SpkNomor = hh.mkb_spk_nomor AND r.Kode = g.Kode
          GROUP BY g.Nomor
        ) agg ON agg.Nomor = h.mkb_nomor
        WHERE h.mkb_tanggal >= ? AND h.mkb_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
        ${extraWhereMKA}
        UNION ALL
        SELECT
          s.spk_nomor        AS Nomor,
          s.spk_tanggal      AS Tanggal,
          IFNULL(v.divisi, '') AS Divisi,
          s.spk_nomor        AS SPK,
          s.spk_nama         AS NamaSpk,
          s.spk_jumlah       AS JumlahSPK,
          0                  AS JumlahAksesoris,
          0                  AS JumlahBelumSiap,
          IF(s.spk_close = 0, 'OPEN', 'CLOSE') AS StatusSpk,
          NULL               AS StatusMka,  -- belum ada MKA, tidak relevan
          s.spk_keterangan   AS Keterangan,
          s.user_create      AS UserCreate,
          s.date_create      AS Created,
          'SPK'              AS RowType
        FROM tspk s
        LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
        WHERE s.spk_tanggal >= ? AND s.spk_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
          AND s.spk_aktif = 'Y'
          AND IFNULL(v.divisi, '') NOT IN ('SPANDUK', 'MMT')
          AND NOT EXISTS (SELECT 1 FROM tmka_hdr h WHERE h.mkb_spk_nomor = s.spk_nomor)
          ${extraWhereSPK}
     ) z
     ORDER BY z.Tanggal ASC, z.Nomor ASC`,
    [...paramsMKA, ...paramsSPK],
  );
  return rows;
};

// --- BROWSE DETAIL (expand per MKA) ---
// Menampilkan: Kode, Nama, Satuan, Ready (stok), Free (Ready - MKA terpakai), Jumlah (dipesan)
// MKA terpakai = total MKA kode ini untuk SPK yg masih open, dikurangi realisasi
const getDetail = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       z.Nomor,
       z.Kode,
       z.NamaAksesoris,
       z.Satuan,
       z.Ready,
       (z.Ready - z.MkaTerpakai) AS Free,
       z.Jumlah
     FROM (
       SELECT
         h.mkb_nomor AS Nomor,
         d.mkbd_brg_kode AS Kode,
         IF(
           IFNULL(b.brg_note, '') = '',
           b.brg_nama,
           CONCAT(b.brg_nama, ' - ', b.brg_note)
         ) AS NamaAksesoris,
         b.brg_satuan AS Satuan,
         IFNULL((
           SELECT SUM(m.mst_stok_in - m.mst_stok_out)
           FROM tmasterstok_acc m
           WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode = d.mkbd_brg_kode
         ), 0) AS Ready,
         IFNULL((
           SELECT SUM(x.mka - x.realisasi)
           FROM (
             SELECT
               a.mkb_nomor AS NomorMKA,
               c.mkbd_brg_kode AS Kode,
               SUM(c.mkbd_jumlah) AS mka,
               IFNULL((
                 SELECT IFNULL(SUM(i.red_jumlah), 0)
                 FROM tgarmenrealisasi_hdr j
                 INNER JOIN tgarmenrealisasi_dtl i ON i.red_nomor = j.re_nomor
                 WHERE j.re_spk_nomor = a.mkb_spk_nomor
                   AND i.red_brg_kode = c.mkbd_brg_kode
               ), 0) AS realisasi
             FROM tmka_hdr a
             INNER JOIN tmka_dtl c ON c.mkbd_nomor = a.mkb_nomor
             WHERE a.mkb_spk_nomor IN (
               SELECT spk_nomor FROM tspk WHERE spk_close = 0
             )
             GROUP BY a.mkb_nomor, c.mkbd_brg_kode
           ) x
           WHERE x.mka > x.realisasi
             AND x.Kode = d.mkbd_brg_kode
             AND x.NomorMKA <> h.mkb_nomor
         ), 0) AS MkaTerpakai,
         d.mkbd_jumlah AS Jumlah
       FROM tmka_hdr h
       LEFT JOIN tmka_dtl d ON d.mkbd_nomor = h.mkb_nomor
       LEFT JOIN tgarmen_brg b
         ON b.brg_kode = d.mkbd_brg_kode AND b.brg_jenis = 'ACCESORIES'
       WHERE h.mkb_nomor = ?
     ) z
     ORDER BY z.Nomor, z.Kode`,
    [nomor],
  );
  return rows;
};

// --- DETAIL REALISASI per kode — drill-down saat Status SPK CLOSE
// tapi Status MKA masih OPEN (produksi sudah selesai, tapi ada
// aksesoris yang belum lengkap direalisasi Gudang). Beda dari
// getDetail() (Ready/Free dari stok) — ini fokus ke Diminta vs
// Realisasi aktual per kode, sumber datanya sama dgn agregasi
// BelumSiapCount di getBrowseList, cuma di sini per-baris bukan count.
// ─────────────────────────────────────────────
const getDetailRealisasi = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       z.Kode,
       z.NamaAksesoris,
       z.Satuan,
       z.Diminta,
       z.Realisasi,
       (z.Diminta - z.Realisasi) AS Kurang,
       IF(z.Realisasi >= z.Diminta, 'SIAP', 'BELUM') AS StatusSiap
     FROM (
       SELECT
         d.mkbd_brg_kode AS Kode,
         IF(
           IFNULL(b.brg_note, '') = '',
           b.brg_nama,
           CONCAT(b.brg_nama, ' - ', b.brg_note)
         ) AS NamaAksesoris,
         b.brg_satuan AS Satuan,
         SUM(d.mkbd_jumlah) AS Diminta,
         IFNULL((
           SELECT SUM(i.red_jumlah)
           FROM tgarmenrealisasi_hdr j
           INNER JOIN tgarmenrealisasi_dtl i ON i.red_nomor = j.re_nomor
           WHERE j.re_spk_nomor = h.mkb_spk_nomor
             AND i.red_brg_kode = d.mkbd_brg_kode
         ), 0) AS Realisasi
       FROM tmka_hdr h
       INNER JOIN tmka_dtl d ON d.mkbd_nomor = h.mkb_nomor
       LEFT JOIN tgarmen_brg b
         ON b.brg_kode = d.mkbd_brg_kode AND b.brg_jenis = 'ACCESORIES'
       WHERE h.mkb_nomor = ?
       GROUP BY d.mkbd_brg_kode, b.brg_nama, b.brg_note, b.brg_satuan
     ) z
     ORDER BY StatusSiap DESC, z.Kode`,
    [nomor],
  );
  return rows;
};

// --- DELETE ---
// Hapus detail dulu, baru header (bukan seperti bug Delphi)
const deleteData = async (nomor) => {
  const [rows] = await db.query(
    `SELECT mkb_nomor FROM tmka_hdr WHERE mkb_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data MKA tidak ditemukan.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tmka_dtl WHERE mkbd_nomor = ?`, [nomor]);
    await conn.query(`DELETE FROM tmka_hdr WHERE mkb_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// --- EXPORT HEADER (semua row browse sesuai filter) ---
const getExportHeader = async (filters) => {
  return getBrowseList(filters);
};

// --- EXPORT DETAIL (semua detail untuk filter periode + kode) ---
const getExportDetail = async (filters) => {
  const { startDate, endDate, kodeBarang, filterByTglSpk } = filters;
  const byTglSpk = filterByTglSpk === true || filterByTglSpk === "true";
  const kodeTrim = (kodeBarang || "").trim();
  let extraJoinWhere = "";
  const queryParams = [];
  if (kodeTrim !== "") {
    extraJoinWhere = ` AND d.mkbd_brg_kode = ?`;
    queryParams.push(kodeTrim);
  }
  queryParams.push(startDate, endDate);

  const dateFilterClause = byTglSpk
    ? `s.spk_tanggal >= ? AND s.spk_tanggal < DATE_ADD(?, INTERVAL 1 DAY)`
    : `h.mkb_tanggal >= ? AND h.mkb_tanggal < DATE_ADD(?, INTERVAL 1 DAY)`;

  const [rows] = await db.query(
    `SELECT
       z.Nomor,
       z.Tanggal,
       z.SPK,
       z.NamaSpk,
       z.Kode,
       z.NamaAksesoris,
       z.Satuan,
       z.Ready,
       (z.Ready - z.MkaTerpakai) AS Free,
       z.Jumlah
     FROM (
       SELECT
         h.mkb_nomor AS Nomor,
         h.mkb_tanggal AS Tanggal,
         h.mkb_spk_nomor AS SPK,
         IFNULL(s.spk_nama, '') AS NamaSpk,
         d.mkbd_brg_kode AS Kode,
         IF(
           IFNULL(b.brg_note, '') = '',
           b.brg_nama,
           CONCAT(b.brg_nama, ' - ', b.brg_note)
         ) AS NamaAksesoris,
         b.brg_satuan AS Satuan,
         IFNULL((
           SELECT SUM(m.mst_stok_in - m.mst_stok_out)
           FROM tmasterstok_acc m
           WHERE m.mst_aktif = 'Y' AND m.mst_brg_kode = d.mkbd_brg_kode
         ), 0) AS Ready,
         IFNULL((
           SELECT SUM(x.mka - x.realisasi)
           FROM (
             SELECT
               a.mkb_nomor AS NomorMKA,
               c.mkbd_brg_kode AS Kode,
               SUM(c.mkbd_jumlah) AS mka,
               IFNULL((
                 SELECT IFNULL(SUM(i.red_jumlah), 0)
                 FROM tgarmenrealisasi_hdr j
                 INNER JOIN tgarmenrealisasi_dtl i ON i.red_nomor = j.re_nomor
                 WHERE j.re_spk_nomor = a.mkb_spk_nomor
                   AND i.red_brg_kode = c.mkbd_brg_kode
               ), 0) AS realisasi
             FROM tmka_hdr a
             INNER JOIN tmka_dtl c ON c.mkbd_nomor = a.mkb_nomor
             WHERE a.mkb_spk_nomor IN (
               SELECT spk_nomor FROM tspk WHERE spk_close = 0
             )
             GROUP BY a.mkb_nomor, c.mkbd_brg_kode
           ) x
           WHERE x.mka > x.realisasi
             AND x.Kode = d.mkbd_brg_kode
             AND x.NomorMKA <> h.mkb_nomor
         ), 0) AS MkaTerpakai,
         d.mkbd_jumlah AS Jumlah
       FROM tmka_hdr h
       LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor
       LEFT JOIN tmka_dtl d ON d.mkbd_nomor = h.mkb_nomor ${extraJoinWhere}
       LEFT JOIN tgarmen_brg b
         ON b.brg_kode = d.mkbd_brg_kode AND b.brg_jenis = 'ACCESORIES'
       WHERE ${dateFilterClause}
     ) z
     WHERE z.Kode IS NOT NULL
     ORDER BY z.Nomor, z.Kode`,
    queryParams,
  );
  return rows;
};

module.exports = {
  getBrowseList,
  getDetail,
  getDetailRealisasi,
  deleteData,
  getExportHeader,
  getExportDetail,
};
