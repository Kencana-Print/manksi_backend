const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — browse SPK aktif divisi garmen (3,4,6) dalam periode.
// Flat query, tidak ada detail/master-detail.
// [FIX] Tambah filter cabang — sebelumnya laporan ini tidak
// dibatasi cabang sama sekali (celah akses). Sekarang ikut pola
// yang sama dengan browse SPK PPIC: user hanya lihat cabang
// sendiri (+ blank/MO sendiri), kecuali HO-/ADMIN (lihat semua)
// atau bagian GUDANG (tambahan lihat P01 & P04).
// ─────────────────────────────────────────────
const getBrowse = async (filters) => {
  const { startDate, endDate, userCabang, userKode, userBagian } = filters;

  let params = [startDate, endDate];
  let whereClause = `WHERE s.spk_divisi IN (3, 4, 6)
      AND s.spk_cmo <> ''
      AND s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?`;

  if (
    userCabang &&
    userCabang !== "HO-" &&
    userCabang !== "ADMIN" &&
    userCabang !== ""
  ) {
    const isGudang = (userBagian || "").toUpperCase() === "GUDANG";
    if (isGudang) {
      whereClause += ` AND (s.spk_cab = ? OR s.spk_cab = "" OR s.spk_cab IS NULL OR s.user_create = ? OR s.spk_cab IN ('P01','P04'))`;
    } else {
      whereClause += ` AND (s.spk_cab = ? OR s.spk_cab = "" OR s.spk_cab IS NULL OR s.user_create = ?)`;
    }
    params.push(userCabang, userKode || "");
  }

  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      s.spk_memo AS MAP,
      s.spk_nomor_po AS PO,
      s.spk_tipe AS Tipe,
      s.spk_divisi AS Divisi,
      s.spk_cab AS Cab,
      s.spk_workshop AS Workshop,
      j.jo_nama AS JoNama,
      s.spk_nama AS NamaSPK,
      s.spk_jumlah AS Jumlah,
      s.spk_ukuran AS Ukuran,
      s.spk_kain AS Kain,
      s.spk_gramasi AS Gramasi,
      s.spk_finishing AS Finishing,
      s.spk_keterangan AS Keterangan
    FROM tspk s
    LEFT JOIN tjenisorder j ON j.jo_kode = s.spk_jo_kode
    ${whereClause}
    ORDER BY s.spk_nama
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
};
