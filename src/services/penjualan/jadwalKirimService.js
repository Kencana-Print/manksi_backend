const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────

/**
 * UNION subquery SPK: gabungkan tspk (aktif) + tmemospk (MAP)
 * Dipakai di browse maupun cetak/export agar konsisten dengan Delphi.
 */
const SPK_UNION = `(
  SELECT spk_nomor, spk_nama, spk_ukuran, spk_kain, spk_cus_kode
  FROM tspk
  WHERE spk_aktif = 'Y'
  UNION ALL
  SELECT mspk_nomor, mspk_nama, mspk_ukuran, mspk_kain, mspk_cus_kode
  FROM tmemospk
)`;

// ─────────────────────────────────────────────────────────
// GET BROWSE (MASTER)
// ─────────────────────────────────────────────────────────
/**
 * Query persis seperti Delphi btnRefreshClick (SQLMaster).
 * Kolom: Nomor, Gudang, Nama_Gudang, Tanggal, No_SPK, Nama_Spk, Ukuran, Kain,
 *        Jumlah, Koli, Realisasi, Koli_Realisasi, Selisih_Jumlah, Selisih_Koli, usr_create
 *
 * Filter:
 *   - tanggal antara tglAwal s.d. tglAkhir
 *   - gudang LIKE '%keyword%' (partial, sesuai Delphi)
 */
const getBrowse = async ({ tglAwal, tglAkhir, gudang = "" }) => {
  const query = `
    SELECT
      a.Nomor_Kirim                                         AS Nomor,
      a.Gudang,
      g.gdg_nama                                            AS Nama_Gudang,
      DATE_FORMAT(a.Tanggal, '%Y-%m-%d')                   AS Tanggal,
      a.spk_nomor                                           AS No_SPK,
      b.spk_nama                                            AS Nama_Spk,
      b.spk_ukuran                                          AS Ukuran,
      b.spk_kain                                            AS Kain,
      IFNULL(a.Jumlah, 0)                                  AS Jumlah,
      IFNULL(a.Koli, 0)                                    AS Koli,
      IFNULL(a.Realisasi, 0)                               AS Realisasi,
      IFNULL(a.koli_Realisasi, 0)                          AS Koli_Realisasi,
      IFNULL(a.Realisasi, 0) - IFNULL(a.Jumlah, 0)        AS Selisih_Jumlah,
      IFNULL(a.koli_Realisasi, 0) - IFNULL(a.Koli, 0)     AS Selisih_Koli,
      a.usr_create
    FROM tjadwalkirim a
    LEFT JOIN ${SPK_UNION} b ON b.spk_nomor = a.spk_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = a.Gudang
    WHERE a.Tanggal >= ?
      AND a.Tanggal <= ?
      AND a.Gudang LIKE ?
    ORDER BY a.Tanggal, a.Nomor_Kirim
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, `%${gudang}%`]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL (per Nomor_Kirim — untuk expand row)
// ─────────────────────────────────────────────────────────
/**
 * Query detail sesuai Delphi SQLDetail.
 * Kolom: Nomor, No_urut, Kota, Uraian, Size, Jumlah, Koli,
 *        Jam_Input (jami), Jam_Ready (Jam), Nomor_SJ (subquery),
 *        Realisasi_Kirim (subquery SUM), Jam_Kirim, Jam_Ambil, Expedisi
 *
 * Subquery SJ: filter h.SJ_Status_otomatis = 0, match sjd_nokirim + sjd_idkirim
 * Bisa dipanggil untuk satu Nomor_Kirim (detail expand) atau
 * dengan array nomor (untuk export detail keseluruhan).
 */
const getDetail = async (nomorKirim) => {
  // Bisa single string atau array
  const nomors = Array.isArray(nomorKirim) ? nomorKirim : [nomorKirim];
  const placeholders = nomors.map(() => "?").join(",");

  const query = `
    SELECT
      a.nomor_kirim                                         AS Nomor,
      a.No_urut,
      a.Kota,
      a.Uraian,
      a.Size,
      IFNULL(a.Jumlah, 0)                                  AS Jumlah,
      IFNULL(a.Koli, 0)                                    AS Koli,
      a.jami                                               AS Jam_Input,
      a.Jam                                                AS Jam_Ready,
      IFNULL((
        SELECT DISTINCT d.SJD_SJ_Nomor
        FROM tsj_dtl d
        INNER JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE h.SJ_Status_otomatis = 0
          AND d.SJD_SPK_Nomor = b.spk_nomor
          AND d.sjd_nokirim = a.nomor_kirim
          AND d.sjd_idkirim = a.No_urut
        LIMIT 1
      ), '')                                                AS Nomor_SJ,
      IFNULL((
        SELECT SUM(d.SJD_Jumlah)
        FROM tsj_dtl d
        INNER JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE h.SJ_Status_otomatis = 0
          AND d.SJD_SPK_Nomor = b.spk_nomor
          AND d.sjd_nokirim = a.nomor_kirim
          AND d.sjd_idkirim = a.No_urut
        GROUP BY d.sjd_nokirim, d.sjd_idkirim
      ), 0)                                                AS Realisasi_Kirim,
      a.Jam_Kirim,
      a.Jam_Ambil,
      a.Expedisi
    FROM tjadwalkirim_dtl a
    INNER JOIN tjadwalkirim b ON a.nomor_kirim = b.Nomor_Kirim
    WHERE a.nomor_kirim IN (${placeholders})
    ORDER BY a.nomor_kirim, a.No_urut
  `;
  const [rows] = await db.query(query, nomors);
  return rows;
};

// ─────────────────────────────────────────────────────────
// GET DETAIL BROWSE (dengan filter periode & gudang)
// Dipakai untuk endpoint export detail yang difilter sama
// dengan browse master (sesuai tombol "Export Detail" Delphi)
// ─────────────────────────────────────────────────────────
const getDetailByFilter = async ({ tglAwal, tglAkhir, gudang = "" }) => {
  // Ambil semua nomor_kirim yang sesuai filter dulu
  const [headers] = await db.query(
    `SELECT Nomor_Kirim FROM tjadwalkirim
     WHERE Tanggal >= ? AND Tanggal <= ? AND Gudang LIKE ?
     ORDER BY Tanggal, Nomor_Kirim`,
    [tglAwal, tglAkhir, `%${gudang}%`],
  );
  if (headers.length === 0) return [];
  const nomors = headers.map((r) => r.Nomor_Kirim);
  return getDetail(nomors);
};

// ─────────────────────────────────────────────────────────
// GET DATA CETAK LENGKAP (untuk print view — gabungan header+detail)
// Sesuai query cetak() Delphi yang join header+detail sekaligus
// ─────────────────────────────────────────────────────────
const getDataCetak = async ({ tglAwal, tglAkhir, gudang = "" }) => {
  const query = `
    SELECT
      a.Gudang,
      a.Nomor_Kirim,
      g.gdg_nama                                               AS Nama_Gudang,
      DATE_FORMAT(a.Tanggal, '%d-%m-%Y')                      AS Tanggal,
      a.spk_nomor                                              AS No_SPK,
      c.spk_nama                                               AS Nama_Spk,
      c.spk_ukuran                                             AS Ukuran,
      c.spk_kain                                               AS Kain,
      IFNULL(a.Jumlah, 0)                                     AS Tot_Jumlah,
      IFNULL(a.Koli, 0)                                       AS Tot_Koli,
      IFNULL(a.Realisasi, 0)                                  AS Realisasi,
      IFNULL(a.koli_Realisasi, 0)                             AS Koli_Realisasi,
      b.No_urut,
      b.Kota,
      b.Uraian,
      b.Size,
      IFNULL(b.Jumlah, 0)                                     AS Jumlah,
      IFNULL(b.Koli, 0)                                       AS Koli,
      -- Konversi jam 12-hour → HH:MM seperti Delphi TIME_FORMAT
      TIME_FORMAT(
        CASE
          WHEN b.Jam LIKE '%PM' AND LEFT(b.Jam, 2) <> '12'
          THEN SEC_TO_TIME(
            (CAST(IF(MID(b.Jam,2,1)=':', LEFT(b.Jam,1), LEFT(b.Jam,2)) AS DECIMAL) + 12) * 3600
            + TIME_TO_SEC(STR_TO_DATE(MID(b.Jam, IF(MID(b.Jam,2,1)=':',2,3), 3), '%i:%s'))
          )
          ELSE STR_TO_DATE(b.Jam, '%h:%i %p')
        END,
        '%H:%i'
      )                                                        AS Jam,
      IFNULL(b.jumlah_kirim, 0)                              AS Jumlah_Kirim,
      IFNULL(b.koli_kirim, 0)                                AS Koli_Kirim,
      TIME_FORMAT(
        CASE
          WHEN b.Jam_Kirim LIKE '%PM' AND LEFT(b.Jam_Kirim, 2) <> '12'
          THEN SEC_TO_TIME(
            (CAST(IF(MID(b.Jam_Kirim,2,1)=':', LEFT(b.Jam_Kirim,1), LEFT(b.Jam_Kirim,2)) AS DECIMAL) + 12) * 3600
            + TIME_TO_SEC(STR_TO_DATE(MID(b.Jam_Kirim, IF(MID(b.Jam_Kirim,2,1)=':',2,3), 3), '%i:%s'))
          )
          ELSE STR_TO_DATE(b.Jam_Kirim, '%h:%i %p')
        END,
        '%H:%i'
      )                                                        AS Jam_Kirim,
      b.Expedisi,
      c.spk_cus_kode                                          AS Cus_Kode,
      e.Cus_nama,
      IFNULL((
        SELECT DISTINCT d.SJD_SJ_Nomor
        FROM tsj_dtl d
        INNER JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE h.SJ_Status_otomatis = 0
          AND d.SJD_SPK_Nomor = a.spk_nomor
          AND d.sjd_nokirim = b.nomor_kirim
          AND d.sjd_idkirim = b.No_urut
        LIMIT 1
      ), '')                                                   AS Nomor_SJ,
      IFNULL((
        SELECT SUM(d.SJD_Jumlah)
        FROM tsj_dtl d
        INNER JOIN tsj_hdr h ON h.SJ_Nomor = d.SJD_SJ_Nomor
        WHERE h.SJ_Status_otomatis = 0
          AND d.SJD_SPK_Nomor = a.spk_nomor
          AND d.sjd_nokirim = b.nomor_kirim
          AND d.sjd_idkirim = b.No_urut
        GROUP BY d.sjd_nokirim, d.sjd_idkirim
      ), 0)                                                    AS Kirim
    FROM tjadwalkirim a
    INNER JOIN tjadwalkirim_dtl b ON a.Nomor_Kirim = b.nomor_kirim
    LEFT JOIN ${SPK_UNION} c ON c.spk_nomor = a.spk_nomor
    LEFT JOIN tcustomer e ON e.Cus_kode = c.spk_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = a.Gudang
    WHERE a.Tanggal >= ?
      AND a.Tanggal <= ?
      AND a.Gudang LIKE ?
    ORDER BY b.nomor_kirim, b.No_urut
  `;
  const [rows] = await db.query(query, [tglAwal, tglAkhir, `%${gudang}%`]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// LOOKUP GUDANG (untuk filter search)
// ─────────────────────────────────────────────────────────
/**
 * Return daftar gudang jadi (gdg_jadi <> 0) untuk filter browse.
 * Di Delphi filter berdasarkan zdivisi, tapi di web kita return semua
 * gudang jadi dan biarkan backend/controller filter jika perlu.
 */
const getListGudang = async (divisi = null) => {
  let query = `SELECT gdg_kode AS Kode, gdg_nama AS Nama FROM tgudang WHERE gdg_jadi <> 0`;
  const params = [];

  if (divisi === 1) {
    query += ` AND gdg_jadi = 1`;
  } else if (divisi === 4) {
    query += ` AND gdg_jadi = 4`;
  }
  // divisi lain → semua gudang jadi (sesuai else branch Delphi)

  query += ` ORDER BY gdg_nama`;
  const [rows] = await db.query(query, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────
/**
 * Validasi:
 * 1. Data harus ada
 * 2. usr_create harus sama dengan userKode yang login
 *    (sesuai logika cxButton4Click Delphi)
 * 3. Hapus header — detail diasumsikan cascade via FK atau ditangani DB
 *    (Delphi hanya delete tjadwalkirim tanpa eksplisit delete detail)
 */
const deleteData = async (nomor, userKode) => {
  // Cek data ada & kepemilikan
  const [[row]] = await db.query(
    `SELECT Nomor_Kirim, usr_create FROM tjadwalkirim WHERE Nomor_Kirim = ?`,
    [nomor],
  );

  if (!row) throw new Error("Data tidak ditemukan.");

  if (row.usr_create !== userKode) {
    throw new Error(
      `Data ini milik ${row.usr_create}. Anda tidak boleh menghapus.`,
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Hapus detail dulu (jaga-jaga jika tidak ada FK cascade)
    await conn.query(`DELETE FROM tjadwalkirim_dtl WHERE nomor_kirim = ?`, [
      nomor,
    ]);
    // Hapus header
    await conn.query(`DELETE FROM tjadwalkirim WHERE Nomor_Kirim = ?`, [nomor]);

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
  getDetailByFilter,
  getDataCetak,
  getListGudang,
  deleteData,
};
