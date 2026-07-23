const db = require("../../../config/database");

const BHN_MARKER = "LL-000400";
const GDG_JAHIT = ["GP003", "GP018"];
const GDG_LIPAT = ["GP004", "GP019"];

// ─────────────────────────────────────────────
// HELPER: filter cabang. ✅ FIX (sesuai konfirmasi): dropdown Cabang
// sekarang beneran fungsional (Delphi asli hardcode P04/MT1 gak
// peduli pilihan dropdown).
// ─────────────────────────────────────────────
const buildCabFilter = (alias, cab) => {
  if (cab === "P04") {
    return `AND (${alias}.spk_cab = 'P04' OR (${alias}.spk_cab = 'MT1' AND ${alias}.spk_divisi IN (3,4,6)))`;
  }
  if (cab === "P01") {
    return `AND (${alias}.spk_cab = 'P01' OR (${alias}.spk_cab = 'MT1' AND ${alias}.spk_divisi IN (3,4,6)))`;
  }
  return ""; // ALL — tanpa filter cabang
};

// ─────────────────────────────────────────────
// MASTER — SPK aktif, replikasi persis kalkulasi Potong/Cetak/
// Bordir/Jahit/Lipat dari tspk_komponen_* + mutasi/BPJ marker
// LL-000400.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, cab = "P04") => {
  const cabFilter = buildCabFilter("s", cab);
  const sql = `
    SELECT x.SPK, x.Tanggal, x.Dateline, x.Cab, x.Divisi, x.Tipe, x.Nama, x.Finishing,
      x.Identifikasi, x.JmlSPK, x.Potong,
      IF(x.SpkSablon = 'N' AND x.SpkSublim = 'N', 0, x.Cetak) AS Cetak,
      IF(x.SpkBordir = 'N', 0, x.Bordir) AS Bordir,
      (x.JmlSPK - (x.MJahit + x.BJahit)) AS Jahit,
      (x.JmlSPK - (x.MLipat + x.BLipat)) AS Lipat
    FROM (
      SELECT
        s.spk_nomor AS SPK,
        DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
        DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
        s.spk_cab AS Cab,
        v.divisi AS Divisi,
        s.spk_tipe AS Tipe,
        s.spk_sablon AS SpkSablon,
        s.spk_sublim AS SpkSublim,
        s.spk_bordir AS SpkBordir,
        s.spk_nama AS Nama,
        s.spk_finishing AS Finishing,
        IF(s.spk_nomor IN (SELECT DISTINCT sk_nomor FROM tspk_komponen_potong), 'Y', 'N') AS Identifikasi,
        s.spk_jumlah AS JmlSPK,
        IFNULL((
          SELECT s.spk_jumlah - a.sk_mutasi FROM tspk_komponen_potong a
          WHERE a.sk_nomor = s.spk_nomor ORDER BY s.spk_jumlah - a.sk_mutasi DESC LIMIT 1
        ), s.spk_jumlah) AS Potong,
        IFNULL((
          SELECT s.spk_jumlah - a.sk_mutasi FROM tspk_komponen_cetak a
          WHERE a.sk_nomor = s.spk_nomor ORDER BY s.spk_jumlah - a.sk_mutasi DESC LIMIT 1
        ), 0) AS Cetak,
        IFNULL((
          SELECT s.spk_jumlah - a.sk_mutasi FROM tspk_komponen_bordir a
          WHERE a.sk_nomor = s.spk_nomor ORDER BY s.spk_jumlah - a.sk_mutasi DESC LIMIT 1
        ), 0) AS Bordir,
        IFNULL((
          SELECT SUM(p.mpd_jumlah) FROM tmutasiproduksi_dtl p
          WHERE p.mpd_spk = s.spk_nomor AND p.mpd_bhn_kode = ? AND p.mpd_gdgp_asal IN (?, ?)
        ), 0) AS MJahit,
        IFNULL((
          SELECT SUM(p.mpd_jumlah) FROM tmutasiproduksi_dtl p
          WHERE p.mpd_spk = s.spk_nomor AND p.mpd_bhn_kode = ? AND p.mpd_gdgp_asal IN (?, ?)
        ), 0) AS MLipat,
        IFNULL((
          SELECT SUM(p.bpjd_jumlah) FROM tbpj_dtl p
          WHERE p.bpjd_spk = s.spk_nomor AND p.bpjd_bhn_kode = ? AND p.bpjd_gdgp_asal IN (?, ?)
        ), 0) AS BJahit,
        IFNULL((
          SELECT SUM(p.bpjd_jumlah) FROM tbpj_dtl p
          WHERE p.bpjd_spk = s.spk_nomor AND p.bpjd_bhn_kode = ? AND p.bpjd_gdgp_asal IN (?, ?)
        ), 0) AS BLipat
      FROM tspk s
      LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
      WHERE s.spk_cmo <> '' AND s.spk_aktif = 'Y' AND s.spk_close = 0
        AND s.spk_tanggal >= ?
        ${cabFilter}
    ) x
    ORDER BY x.Tanggal
  `;
  const params = [
    BHN_MARKER,
    ...GDG_JAHIT,
    BHN_MARKER,
    ...GDG_LIPAT,
    BHN_MARKER,
    ...GDG_JAHIT,
    BHN_MARKER,
    ...GDG_LIPAT,
    startDate,
  ];
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per SPK, breakdown per lini (POTONG/CETAK/BORDIR/JAHIT/
// LIPAT). ✅ BUG FIXED (sesuai keputusan sebelumnya): BPJ untuk
// JAHIT/LIPAT pakai bpjd_bhn_kode (bukan bpjd_jumlah) baik di kolom
// Kode maupun kondisi WHERE.
// ─────────────────────────────────────────────
const getDetail = async (spk) => {
  const sql = `
    SELECT y.SPK, y.Lini, y.Kode, b.Bhn_Name AS Komponen,
      s.spk_jumlah AS JmlSpk, y.Mutasi,
      (CASE
        WHEN y.Lini = 'CETAK' AND s.spk_sablon = 'N' AND s.spk_sublim = 'N' THEN 0
        WHEN y.Lini = 'BORDIR' AND s.spk_bordir = 'N' THEN 0
        ELSE (s.spk_jumlah - y.Mutasi)
      END) AS Kurang
    FROM (
      SELECT a.sk_nomor AS SPK, 'POTONG' AS Lini, a.sk_kode AS Kode, a.sk_mutasi AS Mutasi
      FROM tspk_komponen_potong a WHERE a.sk_nomor = ?
      UNION ALL
      SELECT a.sk_nomor, 'CETAK', a.sk_kode, a.sk_mutasi
      FROM tspk_komponen_cetak a WHERE a.sk_nomor = ?
      UNION ALL
      SELECT a.sk_nomor, 'BORDIR', a.sk_kode, a.sk_mutasi
      FROM tspk_komponen_bordir a WHERE a.sk_nomor = ?
      UNION ALL
      SELECT x.spk, x.lini, x.kode, SUM(x.mutasi) FROM (
        SELECT p.mpd_spk AS spk, 'JAHIT' AS lini, p.mpd_bhn_kode AS kode, p.mpd_jumlah AS mutasi
        FROM tmutasiproduksi_dtl p
        WHERE p.mpd_bhn_kode = ? AND p.mpd_gdgp_asal IN (?, ?) AND p.mpd_spk = ?
        UNION ALL
        SELECT q.bpjd_spk AS spk, 'JAHIT' AS lini, q.bpjd_bhn_kode AS kode, q.bpjd_jumlah AS mutasi
        FROM tbpj_dtl q
        WHERE q.bpjd_bhn_kode = ? AND q.bpjd_gdgp_asal IN (?, ?) AND q.bpjd_spk = ?
      ) x GROUP BY x.spk, x.kode
      UNION ALL
      SELECT x.spk, x.lini, x.kode, SUM(x.mutasi) FROM (
        SELECT p.mpd_spk AS spk, 'LIPAT' AS lini, p.mpd_bhn_kode AS kode, p.mpd_jumlah AS mutasi
        FROM tmutasiproduksi_dtl p
        WHERE p.mpd_bhn_kode = ? AND p.mpd_gdgp_asal IN (?, ?) AND p.mpd_spk = ?
        UNION ALL
        SELECT q.bpjd_spk AS spk, 'LIPAT' AS lini, q.bpjd_bhn_kode AS kode, q.bpjd_jumlah AS mutasi
        FROM tbpj_dtl q
        WHERE q.bpjd_bhn_kode = ? AND q.bpjd_gdgp_asal IN (?, ?) AND q.bpjd_spk = ?
      ) x GROUP BY x.spk, x.kode
    ) y
    LEFT JOIN tbahan b ON b.Bhn_kode = y.Kode
    LEFT JOIN tspk s ON s.spk_nomor = y.SPK
    ORDER BY y.Lini
  `;
  const params = [
    spk,
    spk,
    spk,
    BHN_MARKER,
    ...GDG_JAHIT,
    spk,
    BHN_MARKER,
    ...GDG_JAHIT,
    spk,
    BHN_MARKER,
    ...GDG_LIPAT,
    spk,
    BHN_MARKER,
    ...GDG_LIPAT,
    spk,
  ];
  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
  getDetail,
};
