const db = require("../../config/database");

// ── OUTSTANDING (browse) ──
const getOutstanding = async ({
  search = "",
  startDate,
  endDate,
  page = 1,
  limit = 25,
}) => {
  const searchParam = `%${search}%`;

  const unionSql = `
    (
      SELECT
        'PENGAJUAN_DANA' AS Sumber,
        a.pjh_nomor AS Nomor,
        a.pjh_tanggal AS Tanggal,
        a.pjh_keterangan AS Keterangan,
        c.nama AS Pemohon,
        c.bagian AS Bagian,
        c.lokasi AS Cabang,
        IFNULL((
          SELECT SUM(d.pjd_qty * d.pjd_nilai)
          FROM ga2.tpengajuan2_dtl d
          WHERE d.pjd_pjh_nomor = a.pjh_nomor AND d.pjd_nama <> ''
            AND NOT EXISTS (
              SELECT 1 FROM ga2.tpermintaan_dtl td
              JOIN ga2.tpermintaan_hdr th ON th.pmt_nomor = td.pmd_pmt_nomor
              WHERE th.pmt_pjh_nomor = a.pjh_nomor AND td.pmd_nourut = d.pjd_nourut
                AND (td.pmd_tanggal_approved IS NOT NULL OR td.pmd_tanggal_reject IS NOT NULL)
            )
            AND NOT EXISTS (
              SELECT 1 FROM tpengajuan_uang_muka_dtl pd
              JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
              WHERE pd.pumd_sumber = 'PENGAJUAN_DANA' AND pd.pumd_nomor_sumber = a.pjh_nomor
                AND pd.pumd_item_nourut = d.pjd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL')
            )
        ), 0) AS Nominal
      FROM ga2.tpengajuan2_hdr a
      LEFT JOIN ga2.peminta c ON c.nik = a.pjh_nik
      WHERE EXISTS (
        SELECT 1 FROM ga2.tpengajuan2_dtl d
        WHERE d.pjd_pjh_nomor = a.pjh_nomor AND d.pjd_nama <> ''
          AND NOT EXISTS (
            SELECT 1 FROM ga2.tpermintaan_dtl td
            JOIN ga2.tpermintaan_hdr th ON th.pmt_nomor = td.pmd_pmt_nomor
            WHERE th.pmt_pjh_nomor = a.pjh_nomor AND td.pmd_nourut = d.pjd_nourut
              AND (td.pmd_tanggal_approved IS NOT NULL OR td.pmd_tanggal_reject IS NOT NULL)
          )
          AND NOT EXISTS (
            SELECT 1 FROM tpengajuan_uang_muka_dtl pd
            JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
            WHERE pd.pumd_sumber = 'PENGAJUAN_DANA' AND pd.pumd_nomor_sumber = a.pjh_nomor
              AND pd.pumd_item_nourut = d.pjd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL')
          )
      )
      ${startDate && endDate ? "AND a.pjh_tanggal BETWEEN ? AND ?" : ""}
      AND (a.pjh_nomor LIKE ? OR a.pjh_keterangan LIKE ?)
    )
    UNION ALL
    (
      SELECT
        'PERMINTAAN_PEMBELIAN' AS Sumber,
        h.mb_nomor AS Nomor,
        h.mb_tanggal AS Tanggal,
        h.mb_ket AS Keterangan,
        h.mb_mintake AS Pemohon,
        h.mb_bagian AS Bagian,
        h.mb_cab AS Cabang,
        IFNULL((
          SELECT SUM(d.mbd_jumlah * d.mbd_harga)
          FROM tgarmenmintabeli_dtl d
          WHERE d.mbd_nomor = h.mb_nomor
            AND d.mbd_jumlah > IFNULL((
              SELECT SUM(d2.mbd2_jumlah) FROM tgarmenmintabeli_dtl2 d2
              WHERE d2.mbd2_nomor = d.mbd_nomor AND d2.mbd2_brg_kode = d.mbd_brg_kode
            ), 0)
            AND NOT EXISTS (
              SELECT 1 FROM tpengajuan_uang_muka_dtl pd
              JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
              WHERE pd.pumd_sumber = 'PERMINTAAN_PEMBELIAN' AND pd.pumd_nomor_sumber = h.mb_nomor
                AND pd.pumd_item_nourut = d.mbd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL')
            )
        ), 0) AS Nominal
      FROM tgarmenmintabeli_hdr h
      WHERE EXISTS (
        SELECT 1 FROM tgarmenmintabeli_dtl d
        WHERE d.mbd_nomor = h.mb_nomor
          AND d.mbd_jumlah > IFNULL((
            SELECT SUM(d2.mbd2_jumlah) FROM tgarmenmintabeli_dtl2 d2
            WHERE d2.mbd2_nomor = d.mbd_nomor AND d2.mbd2_brg_kode = d.mbd_brg_kode
          ), 0)
          AND NOT EXISTS (
            SELECT 1 FROM tpengajuan_uang_muka_dtl pd
            JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
            WHERE pd.pumd_sumber = 'PERMINTAAN_PEMBELIAN' AND pd.pumd_nomor_sumber = h.mb_nomor
              AND pd.pumd_item_nourut = d.mbd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL')
          )
      )
      ${startDate && endDate ? "AND h.mb_tanggal BETWEEN ? AND ?" : ""}
      AND (h.mb_nomor LIKE ? OR h.mb_ket LIKE ?)
    )
  `;

  const dateParams = startDate && endDate ? [startDate, endDate] : [];
  const baseParams = [
    ...dateParams,
    searchParam,
    searchParam,
    ...dateParams,
    searchParam,
    searchParam,
  ];

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM (${unionSql}) x`,
    baseParams,
  );
  const offset = (Number(page) - 1) * Number(limit);
  const [rows] = await db.query(
    `SELECT * FROM (${unionSql}) x ORDER BY x.Tanggal DESC, x.Nomor DESC LIMIT ? OFFSET ?`,
    [...baseParams, Number(limit), offset],
  );
  return { items: rows, total: Number(total) };
};

// ── OUTSTANDING DETAIL (per sumber) ──
const getOutstandingDetail = async (sumber, nomorHeader) => {
  if (sumber === "PENGAJUAN_DANA") {
    const [rows] = await db.query(
      `SELECT
         a.pjd_nourut AS ItemNourut,
         a.pjd_nama AS Nama,
         a.pjd_spesifikasi AS Spesifikasi,
         a.pjd_satuan AS Satuan,
         a.pjd_qty AS QtyPengajuan,
         a.QtyVerifikasi AS QtyVerifikasi,
         a.QtyBeli AS QtyBeli,
         a.QtyRealisasi AS QtyRealisasi,
         (a.pjd_qty * a.pjd_nilai) AS RpPengajuan,
         a.RpApproved AS RpApproved,
         a.Deadline AS Deadline,
         a.NameVerified AS NameVerified,
         a.NameApproved AS NameApproved,
         a.pjd_kegunaan AS Kegunaan,
         a.Keterangan AS Keterangan
       FROM ga2.viewpengajuan a
       WHERE a.pjh_nomor = ?
         AND NOT EXISTS (
           SELECT 1 FROM tpengajuan_uang_muka_dtl pd
           JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
           WHERE pd.pumd_sumber = 'PENGAJUAN_DANA' AND pd.pumd_nomor_sumber = ?
             AND pd.pumd_item_nourut = a.pjd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL')
         )
       ORDER BY a.pjd_nourut`,
      [nomorHeader, nomorHeader],
    );
    return rows;
  }

  if (sumber === "PERMINTAAN_PEMBELIAN") {
    const [rows] = await db.query(
      `SELECT d.mbd_nourut AS ItemNourut,
              d.mbd_brg_kode AS Kode,
              IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama, " - ", b.brg_note)) AS Nama,
              b.brg_satuan AS Satuan, d.mbd_jumlah AS Qty, (d.mbd_jumlah * d.mbd_harga) AS Nominal
       FROM tgarmenmintabeli_dtl d
       LEFT JOIN tgarmen_brg b ON b.brg_kode = d.mbd_brg_kode
       WHERE d.mbd_nomor = ?
         AND d.mbd_jumlah > IFNULL((
           SELECT SUM(d2.mbd2_jumlah) FROM tgarmenmintabeli_dtl2 d2
           WHERE d2.mbd2_nomor = d.mbd_nomor AND d2.mbd2_brg_kode = d.mbd_brg_kode
         ), 0)
         AND NOT EXISTS (
           SELECT 1 FROM tpengajuan_uang_muka_dtl pd
           JOIN tpengajuan_uang_muka_hdr ph ON ph.pum_nomor = pd.pumd_pum_nomor
           WHERE pd.pumd_sumber = 'PERMINTAAN_PEMBELIAN' AND pd.pumd_nomor_sumber = ?
             AND pd.pumd_item_nourut = d.mbd_nourut AND ph.pum_status NOT IN ('DITOLAK','BATAL')
         )
       ORDER BY d.mbd_nourut`,
      [nomorHeader, nomorHeader],
    );
    return rows;
  }

  throw new Error("Sumber tidak dikenali.");
};

// ── HISTORY (browse) ──
const getHistory = async ({ startDate, endDate, cabang }) => {
  let sql = `
    SELECT
      b.bon_nomor        AS Nomor,
      DATE_FORMAT(b.bon_tanggal, '%Y-%m-%d') AS Tanggal,
      IF(b.bon_jenis=0,'KAS','BANK') AS Jenis,
      r.rek_nama         AS NamaAccount,
      b.bon_pjh_nomor    AS Pjh,
      b.bon_nota         AS Nota,
      b.bon_penerima     AS Penerima,
      b.bon_nominal      AS Nominal,
      IF(b.bon_jur_no='', 0,
        IFNULL((SELECT SUM(d.jurd_kredit) FROM financenew.tjurnalitem d WHERE d.jurd_jur_no = b.bon_jur_no), 0)
      ) AS Terpakai,
      (b.bon_nominal - IF(b.bon_jur_no='', 0,
        IFNULL((SELECT SUM(d.jurd_kredit) FROM financenew.tjurnalitem d WHERE d.jurd_jur_no = b.bon_jur_no), 0)
      )) AS Sisa,
      b.bon_keterangan   AS Keterangan,
      IF(b.bon_selesai=0,'Belum','Sudah') AS Selesai,
      DATE_FORMAT(b.date_create, '%Y-%m-%d %H:%i:%s') AS TanggalDibuat,
      b.user_create      AS UserDibuat
    FROM financenew.tkasbon b
    LEFT JOIN financenew.trekening r ON r.rek_kode = b.bon_rek_kode
    WHERE 1=1
  `;
  const params = [];

  if (startDate && endDate) {
    sql += ` AND b.bon_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (cabang) {
    sql += ` AND b.bon_cabang = ?`;
    params.push(cabang);
  }
  sql += ` ORDER BY b.bon_tanggal DESC, b.bon_nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── HISTORY DELETE ──
const deleteHistory = async (nomor) => {
  const [[bon]] = await db.query(
    `SELECT bon_selesai, bon_pjh_nomor FROM financenew.tkasbon WHERE bon_nomor = ?`,
    [nomor],
  );
  if (!bon) throw new Error("Data tidak ditemukan.");
  if (Number(bon.bon_selesai) !== 0)
    throw new Error("Sudah ada penyelesaian. Tidak bisa dihapus.");

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    if (bon.bon_pjh_nomor) {
      await conn.query(
        `UPDATE ga2new.tpermintaan_hdr SET pmt_approval = 0 WHERE pmt_pjh_nomor = ?`,
        [bon.bon_pjh_nomor],
      );
      await conn.query(
        `UPDATE ga2new.tpermintaan_dtl SET
           pmd_tanggal_approved = NULL, pmd_user_approved = '',
           pmd_bon = '', pmd_dana_approved = 0,
           pmd_user_reject = '', pmd_tanggal_reject = NULL,
           pmd_kode_reject = 0
         WHERE pmd_bon = ?`,
        [nomor],
      );
    }
    await conn.query(`DELETE FROM financenew.tkasbon WHERE bon_nomor = ?`, [
      nomor,
    ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = {
  getOutstanding,
  getOutstandingDetail,
  getHistory,
  deleteHistory,
};
