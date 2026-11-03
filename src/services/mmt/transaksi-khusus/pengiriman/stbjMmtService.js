const pool = require("../../../../config/database");
const { format } = require('date-fns');

/**
 * Mengambil Laporan Stok Barang Jadi MMT
 * (Logika dari btnRefreshClick -> Self.SQLMaster)
 */
const getReport = async (startDate, endDate) => {
  // Guard: tanggal kosong/invalid TIDAK boleh jadi klausa zero-date —
  // filter tanggal di-skip (tanpa filter) bila tidak valid.
  // (format(new Date("")) melempar RangeError, jadi validasi dulu.)
  const isDateStr = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v));
  const dateConds = [];
  const params = [];
  if (isDateStr(startDate)) {
    dateConds.push("spk_tanggal >= ?");
    params.push(format(new Date(startDate), "yyyy-MM-dd"));
  }
  if (isDateStr(endDate)) {
    dateConds.push("spk_tanggal <= ?");
    params.push(format(new Date(endDate), "yyyy-MM-dd"));
  }

  const sql = `
    SELECT 
      SPK_NOMOR, spk_tanggal AS TANGGAL, spk_Dateline AS DEADLINE,
      DIVISI,
      spk_cus_kode AS CUSTOMER, cus_nama AS NAMA_CUSTOMER, spk_nama AS NAMA,
      spk_jo_kode AS "J_ORDER", jo_nama AS "NAMA_J_ORDER",
      IF(spk_jumlah_kirim >= spk_jumlah, 'Closed', 'Open') AS STATUS,
      spk_ukuran AS UKURAN, spk_kain AS KAIN, spk_finishing AS FINISHING, 
      IFNULL(spk_jumlah, 0) AS JUMLAH_ORDER,
      stbj_tanggal AS TANGGAL_MASUK, 
      IFNULL(jumlah_p2, 0) AS P2, 
      IFNULL(jumlah_mmt, 0) AS MMT,
      IFNULL(stbj_jumlah, 0) AS "J_JADI",
      IFNULL(sjd_jumlah, 0) AS "J_KIRIM",
      (IFNULL(stbj_jumlah, 0) - IFNULL(sjd_jumlah, 0)) AS "J_STOCK", 
      tg_kirim AS LAST_KIRIM
    FROM tspk
    LEFT JOIN tcustomer ON (cus_kode = spk_cus_kode)
    LEFT JOIN tjenisorder ON (jo_kode = spk_jo_kode)
    LEFT JOIN tdivisi ON (kode = spk_divisi)
    LEFT JOIN (
      SELECT sjd_spk_nomor AS nospk, MAX(sj_tanggal) AS tg_kirim, SUM(sjd_jumlah) AS sjd_jumlah 
      FROM (
        SELECT a.*, b.* FROM tsj_hdr a
        INNER JOIN tsj_dtl b ON (sjd_sj_nomor = sj_nomor)
      ) xx 
      WHERE sj_divisi IN (5) AND sj_approve = 1 
      GROUP BY sjd_spk_nomor
    ) xx ON (nospk = spk_nomor)
    LEFT JOIN (
      SELECT 
        stbjd_spk_nomor, 
        MIN(stbj_tanggal) AS stbj_tanggal, 
        SUM(IFNULL(stbjd_jumlah, 0)) AS stbj_jumlah,
        SUM(CASE WHEN stbj_gdg_kode = 'WH002' THEN IFNULL(stbjd_jumlah, 0) ELSE 0 END) AS jumlah_p2,
        SUM(CASE WHEN stbj_gdg_kode = 'WH-010' THEN IFNULL(stbjd_jumlah, 0) ELSE 0 END) AS jumlah_MMT
      FROM tstbj_hdr a 
      INNER JOIN tstbj_dtl b ON (stbjd_stbj_nomor = stbj_nomor)
      GROUP BY stbjd_spk_nomor
    ) x ON (stbjd_spk_nomor = spk_nomor)
    WHERE spk_divisi IN (5)
    ${dateConds.length ? "AND " + dateConds.join(" AND ") : ""}
  `;

  const [rows] = await pool.query(sql, params);
  return rows;
};

module.exports = {
  getReport
};