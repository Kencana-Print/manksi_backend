const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// BROWSE — list header pembuatan barcode
// ⚠️ Filter cabang: replikasi `if frmMenu.CAB<>'' then ... and
// h.bar_cab=frmMenu.CAB` — user dengan cabang kosong (HQ) lihat
// semua, user dengan cabang spesifik cuma lihat punya cabangnya.
// Diasumsikan req.user.cabang (pola sama kayak searchGudangProduksi).
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query, userCabang) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;

  let sql = `
    SELECT
      h.bar_nomor AS nomor,
      DATE_FORMAT(h.bar_tanggal, '%Y-%m-%d') AS tanggal,
      h.bar_cab AS cab,
      h.bar_bpb AS noBpb,
      u.user_nama AS usr
    FROM tbahan_barcode_hdr h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
    WHERE h.bar_tanggal BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  const isHeadOffice = !userCabang || userCabang === "HO-";
  if (!isHeadOffice) {
    sql += ` AND h.bar_cab = ?`;
    params.push(userCabang);
  }

  sql += ` ORDER BY h.bar_tanggal, h.bar_nomor`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DETAIL — dipanggil on-demand saat row di-expand
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor) => {
  const sql = `
    SELECT
      d.bard_nomor AS nomor,
      d.bard_kode AS kode,
      d.bard_barcode AS barcode,
      b.bhn_name AS nama,
      b.bhn_satuan AS satuan,
      d.bard_jumlah AS jumlah
    FROM tbahan_barcode_dtl d
    LEFT JOIN tbahan b ON b.bhn_kode = d.bard_kode
    WHERE d.bard_nomor = ?
    ORDER BY d.bard_nourut
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// DELETE — replikasi cxButton4Click PERSIS (cuma hapus header,
// tbahan_barcode_dtl dibiarkan — konfirmasi dari user).
// ⚠️ Gak ada pengecekan tutup buku/closing period sama sekali di
// source Delphi ini.
// ─────────────────────────────────────────────────────────
const deleteBarcode = async (nomor) => {
  const [result] = await db.query(
    `DELETE FROM tbahan_barcode_hdr WHERE bar_nomor = ?`,
    [nomor],
  );
  if (result.affectedRows === 0) {
    throw new Error("Data tidak ditemukan.");
  }
  return { nomor };
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
  deleteBarcode,
};
