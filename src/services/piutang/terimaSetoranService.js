const db = require("../../config/database");

// ── Dropdown cabang ───────────────────────────────────────────────────
// Delphi: SELECT CONCAT(gdg_kode," - ",gdg_nama) FROM retail.tgudang ORDER BY gdg_kode
const getCabang = async () => {
  const [rows] = await db.query(
    `SELECT gdg_kode AS kode, gdg_nama AS nama
     FROM retail.tgudang
     ORDER BY gdg_kode`,
  );
  return rows;
};

// ── Browse master ─────────────────────────────────────────────────────
// Delphi:
//   SELECT h.fsk_nomor Nomor, h.fsk_tanggal TglSetor, h.fsk_tanggalv TglVerifikasi,
//          h.user_create Created, h.fsk_userv Verified
//   FROM retail.tform_setorkasir_hdr h
//   WHERE LEFT(h.fsk_nomor,3)=<kode_cab3>
//     AND h.fsk_tanggal >= <startDate>
//     AND h.fsk_tanggal <= <endDate>
//   ORDER BY h.fsk_tanggal
//
// Warna merah: fsk_userv = '' (belum verifikasi)
// → dikembalikan sebagai field Verified kosong, frontend handle warnanya
const getBrowse = async (startDate, endDate, cabang) => {
  const [rows] = await db.query(
    `SELECT
       h.fsk_nomor                            AS Nomor,
       DATE_FORMAT(h.fsk_tanggal,'%Y-%m-%d') AS TglSetor,
       DATE_FORMAT(h.fsk_tanggalv,'%Y-%m-%d') AS TglVerifikasi,
       h.user_create                          AS Created,
       h.fsk_userv                            AS Verified
     FROM retail.tform_setorkasir_hdr h
     WHERE LEFT(h.fsk_nomor, 3) = ?
       AND h.fsk_tanggal >= ?
       AND h.fsk_tanggal <= ?
     ORDER BY h.fsk_tanggal`,
    [cabang, startDate, endDate],
  );
  return rows;
};

// ── Browse detail ─────────────────────────────────────────────────────
// Delphi:
//   SELECT d.fskd2_nomor Nomor, d.fskd2_jenis Jenis,
//          d.fskd2_nominal NominalSetor, d.fskd2_nominalv NominalVerifikasi
//   FROM retail.tform_setorkasir_dtl2 d
//   INNER JOIN retail.tform_setorkasir_hdr h ON h.fsk_nomor = d.fskd2_nomor
//   WHERE LEFT(h.fsk_nomor,3)=<kode_cab3>
//     AND h.fsk_tanggal >= <startDate>
//     AND h.fsk_tanggal <= <endDate>
//   ORDER BY d.fskd2_nomor
//
// Filter cabang & tanggal tetap via JOIN ke header — sama persis dengan Delphi
const getBrowseDetail = async (startDate, endDate, cabang) => {
  const [rows] = await db.query(
    `SELECT
       d.fskd2_nomor    AS Nomor,
       d.fskd2_jenis    AS Jenis,
       d.fskd2_nominal  AS NominalSetor,
       d.fskd2_nominalv AS NominalVerifikasi
     FROM retail.tform_setorkasir_dtl2 d
     INNER JOIN retail.tform_setorkasir_hdr h ON h.fsk_nomor = d.fskd2_nomor
     WHERE LEFT(h.fsk_nomor, 3) = ?
       AND h.fsk_tanggal >= ?
       AND h.fsk_tanggal <= ?
     ORDER BY d.fskd2_nomor`,
    [cabang, startDate, endDate],
  );
  return rows;
};

// Khusus filter pending dari dashboard — semua cabang, tanpa filter tanggal
const getBrowsePendingAll = async () => {
  const [rows] = await db.query(
    `SELECT
       h.fsk_nomor                             AS Nomor,
       DATE_FORMAT(h.fsk_tanggal, '%Y-%m-%d')  AS TglSetor,
       DATE_FORMAT(h.fsk_tanggalv, '%Y-%m-%d') AS TglVerifikasi,
       h.user_create                            AS Created,
       h.fsk_userv                              AS Verified
     FROM retail.tform_setorkasir_hdr h
     WHERE (h.fsk_userv = '' OR h.fsk_userv IS NULL)
     ORDER BY h.fsk_tanggal`,
  );
  return rows;
};

module.exports = { getCabang, getBrowse, getBrowseDetail, getBrowsePendingAll };
