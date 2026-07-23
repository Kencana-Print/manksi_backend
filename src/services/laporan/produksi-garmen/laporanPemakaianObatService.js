const db = require("../../../config/database");

// ─────────────────────────────────────────────
// HELPER: filter cabang & SPK, dipakai di master & detail
// ─────────────────────────────────────────────
const buildFilters = (cab, spk) => {
  let where = "";
  const params = [];
  if (cab && cab !== "ALL") {
    where += " AND h.ob_cab = ?";
    params.push(cab);
  }
  if (spk) {
    where += " AND h.ob_spk_nomor = ?";
    params.push(spk);
  }
  return { where, params };
};

// ─────────────────────────────────────────────
// MASTER — per kode obat (agregat), kolom Supplier cuma ditampilkan
// kalau user.flags.lihatSup=1 (persis kondisi zLihatSup Delphi).
// ─────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  cab = "P04",
  spk = "",
  canLihatSup = false,
) => {
  const { where, params } = buildFilters(cab, spk);

  const sql = `
    SELECT x.Kode, x.JenisObat, x.Jumlah AS JumlahKg, (x.Jumlah * x.brg_harga) AS Harga
      ${canLihatSup ? ", x.Supplier" : ""}
    FROM (
      SELECT d.obd_okode AS Kode, o.brg_nama AS JenisObat, SUM(d.obd_jumlah) AS Jumlah,
        o.brg_harga, s.sup_nama AS Supplier
      FROM tpakaiobat_hdr h
      LEFT JOIN tpakaiobat_dtl d ON d.obd_nomor = h.ob_nomor
      LEFT JOIN tgarmen_brg o ON o.brg_kode = d.obd_okode
      LEFT JOIN tsupplier s ON s.sup_kode = o.brg_sup_kode
      WHERE h.ob_tanggal >= ? AND h.ob_tanggal <= ?
        ${where}
      GROUP BY d.obd_okode
    ) x
    ORDER BY x.JenisObat
  `;
  const [rows] = await db.query(sql, [startDate, endDate, ...params]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per kode obat, breakdown per SPK
// ─────────────────────────────────────────────
const getDetail = async (kode, startDate, endDate, cab = "P04", spk = "") => {
  const { where, params } = buildFilters(cab, spk);

  const sql = `
    SELECT x.Kode, x.Spk, x.NamaSPK, x.Jumlah AS JumlahKg, (x.Jumlah * x.brg_harga) AS Harga
    FROM (
      SELECT d.obd_okode AS Kode, h.ob_spk_nomor AS Spk,
        IFNULL(s.spk_nama, m.mspk_nama) AS NamaSPK,
        SUM(d.obd_jumlah) AS Jumlah, o.brg_harga
      FROM tpakaiobat_hdr h
      LEFT JOIN tpakaiobat_dtl d ON d.obd_nomor = h.ob_nomor
      LEFT JOIN tgarmen_brg o ON o.brg_kode = d.obd_okode
      LEFT JOIN tspk s ON s.spk_nomor = h.ob_spk_nomor
      LEFT JOIN tmemospk m ON m.mspk_nomor = h.ob_spk_nomor
      WHERE h.ob_tanggal >= ? AND h.ob_tanggal <= ?
        ${where}
      GROUP BY d.obd_okode, h.ob_spk_nomor
    ) x
    WHERE x.Kode = ?
    ORDER BY x.Spk
  `;
  const [rows] = await db.query(sql, [startDate, endDate, ...params, kode]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — semua kode+SPK sesuai filter (query tunggal, bukan
// loop per kode — lebih efisien)
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, cab = "P04", spk = "") => {
  const { where, params } = buildFilters(cab, spk);

  const sql = `
    SELECT d.obd_okode AS Kode, o.brg_nama AS JenisObat,
      h.ob_spk_nomor AS Spk, IFNULL(s.spk_nama, m.mspk_nama) AS NamaSPK,
      SUM(d.obd_jumlah) AS JumlahKg, SUM(d.obd_jumlah) * o.brg_harga AS Harga
    FROM tpakaiobat_hdr h
    LEFT JOIN tpakaiobat_dtl d ON d.obd_nomor = h.ob_nomor
    LEFT JOIN tgarmen_brg o ON o.brg_kode = d.obd_okode
    LEFT JOIN tspk s ON s.spk_nomor = h.ob_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = h.ob_spk_nomor
    WHERE h.ob_tanggal >= ? AND h.ob_tanggal <= ?
      ${where}
    GROUP BY d.obd_okode, h.ob_spk_nomor
    ORDER BY o.brg_nama, h.ob_spk_nomor
  `;
  const [rows] = await db.query(sql, [startDate, endDate, ...params]);
  return rows;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
