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
  const { startDate, endDate, kodeBarang } = filters;

  let params = [startDate, endDate];
  let extraWhere = "";

  if (kodeBarang && kodeBarang.trim() !== "") {
    extraWhere = ` AND EXISTS (
      SELECT 1 FROM tmka_dtl d2
      WHERE d2.mkbd_nomor = h.mkb_nomor
        AND d2.mkbd_brg_kode = ?
    )`;
    params.push(kodeBarang.trim());
  }

  const [rows] = await db.query(
    `SELECT
       h.mkb_nomor        AS Nomor,
       h.mkb_tanggal      AS Tanggal,
       IFNULL(v.divisi, '') AS Divisi,
       h.mkb_spk_nomor    AS SPK,
       IFNULL(s.spk_nama, '') AS NamaSpk,
       IFNULL(s.spk_jumlah, 0) AS JumlahSPK,
       IF(IFNULL(s.spk_close, 0) = 0, 'OPEN', 'CLOSE') AS StatusSPK,
       h.mkb_note         AS Keterangan,
       h.user_create      AS UserCreate,
       h.date_create      AS Created
     FROM tmka_hdr h
     LEFT JOIN tspk s ON s.spk_nomor = h.mkb_spk_nomor
     LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
     WHERE h.mkb_tanggal >= ? AND h.mkb_tanggal <= ?
     ${extraWhere}
     ORDER BY h.mkb_tanggal ASC, h.mkb_nomor ASC`,
    params,
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
  const { startDate, endDate, kodeBarang } = filters;

  // extraWhere diletakkan di JOIN tmka_dtl agar filter kode tidak
  // menghilangkan row header (LEFT JOIN tetap jalan)
  let extraJoinWhere = "";
  const detailParams = [startDate, endDate];

  if (kodeBarang && kodeBarang.trim() !== "") {
    extraJoinWhere = ` AND d.mkbd_brg_kode = ?`;
    detailParams.splice(0, 0, kodeBarang.trim()); // masuk sebelum startDate/endDate
  }

  // Susun params: [kodeBarang?, startDate, endDate]
  const queryParams = kodeBarang ? [kodeBarang.trim(), startDate, endDate] : [startDate, endDate];

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
       WHERE h.mkb_tanggal >= ? AND h.mkb_tanggal <= ?
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
  deleteData,
  getExportHeader,
  getExportDetail,
};