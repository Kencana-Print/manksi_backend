const db = require("../../../config/database");

const BHN_MARKER = "LL-000400";

// ─────────────────────────────────────────────
// MASTER — flat query, toggle mode FINISHING/KOLI. Persis Delphi:
// tanpa filter tanggal, cuma cabang (P01/P04, wajib salah satu).
// ─────────────────────────────────────────────
const getBrowse = async (lini = "FINISHING", cab = "P04") => {
  const isFinishing = lini === "FINISHING";
  const gdgJahit = cab === "P04" ? "GP003" : "GP018";
  const gdgLipat = cab === "P04" ? "GP004" : "GP019";

  let selectQty2Cmt;
  let joinGdgAsal;

  if (isFinishing) {
    selectQty2Cmt = `
      IFNULL((
        SELECT SUM(b.mpd_jumlah) FROM tmutasiproduksi_hdr a
        INNER JOIN tmutasiproduksi_dtl b ON b.mpd_mph_nomor = a.mph_nomor
        WHERE b.mpd_spk = s.spk_nomor
          AND b.mpd_bhn_kode = ?
          AND b.mpd_gdgp_asal = ?
          AND a.mph_cab = ?
      ), 0) AS Qty2,
      (
        SELECT IFNULL(SUM(i.bpjd_Jumlah), 0) FROM tbpj_dtl i
        WHERE i.bpjd_bhn_kode = ?
          AND i.bpjd_gdgp_asal = ?
          AND i.bpjd_spk = s.spk_nomor
      ) AS Cmt
    `;
    joinGdgAsal = `AND h.mph_gdgasal = ?`;
  } else {
    selectQty2Cmt = `s.spk_jumlah_jadi AS Qty2, 0 AS Cmt`;
    joinGdgAsal = `AND h.mph_gdgasal = ?`;
  }

  const sql = `
    SELECT x.SPK, x.Divisi, x.TglSPK, x.Dateline, x.NamaSPK, x.QtySPK,
      ${isFinishing ? "x.Qty1 AS Jahit, x.Cmt, x.Qty2 AS Finishing," : "x.Qty1 AS Finishing, x.Qty2 AS Stbj,"}
      ((x.Qty1 + x.Cmt) - x.Qty2) AS Stok
    FROM (
      SELECT
        s.spk_nomor AS SPK,
        v.divisi AS Divisi,
        DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS TglSPK,
        DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
        s.spk_nama AS NamaSPK,
        s.spk_jumlah AS QtySPK,
        SUM(d.mpd_jumlah) AS Qty1,
        ${selectQty2Cmt}
      FROM tspk s
      INNER JOIN tmutasiproduksi_hdr h ON h.mph_spk_nomor = s.spk_nomor
        ${joinGdgAsal}
        AND h.mph_cab = ?
      LEFT JOIN tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor AND d.mpd_bhn_kode = ?
      LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
      WHERE s.spk_aktif = 'Y' AND s.spk_close = 0
      GROUP BY s.spk_nomor
    ) x
    WHERE (x.Qty1 + x.Cmt) <> x.Qty2
    ORDER BY x.NamaSPK
  `;

  const params = isFinishing
    ? [
        BHN_MARKER,
        gdgLipat,
        cab, // Qty2 subquery
        BHN_MARKER,
        gdgJahit, // Cmt subquery
        gdgJahit,
        cab, // JOIN header
        BHN_MARKER, // LEFT JOIN detail
      ]
    : [
        gdgLipat,
        cab, // JOIN header
        BHN_MARKER, // LEFT JOIN detail
      ];

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
};
