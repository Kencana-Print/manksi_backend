const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — rekap per Permintaan Bahan (Nomor), hanya yang masih
// ada Sisa (belum full di-realisasikan lewat mutasi/BPJ).
// Tujuan diambil dari nama gudang produksi, dipotong prefix 3
// karakter (persis Delphi: right(gdgp_nama, len-3)).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cab = "ALL", spk = "") => {
  let where = `WHERE h.promin_tanggal >= ? AND h.promin_tanggal <= ?`;
  const params = [startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND p.gdgp_cab = ?`;
    params.push(cab);
  }
  if (spk) {
    where += ` AND h.promin_spk_nomor = ?`;
    params.push(spk);
  }

  const sql = `
    SELECT x.*, (x.JmlLhk + x.JmlCmt) AS TotalPotong,
      (x.JmlMinta - (x.JmlLhk + x.JmlCmt)) AS Sisa
    FROM (
      SELECT
        h.promin_nomor AS Nomor,
        DATE_FORMAT(h.promin_tanggal, '%Y-%m-%d') AS Tanggal,
        RIGHT(p.gdgp_nama, LENGTH(p.gdgp_nama) - 3) AS Tujuan,
        h.promin_spk_nomor AS Spk,
        IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
        SUM(d.promind_Jumlah) AS JmlMinta,
        IFNULL((
          SELECT SUM(j.mph_qty_berat) FROM tmutasiproduksi_hdr j
          WHERE j.mph_nomaterial = h.promin_nomor
        ), 0) AS JmlLhk,
        IFNULL((
          SELECT SUM(j.bpj_qty_berat) FROM tbpj_hdr j
          WHERE j.bpj_nomaterial = h.promin_nomor
        ), 0) AS JmlCmt
      FROM tproduksiminta_hdr h
      INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.promin_gdgp_kode
      LEFT JOIN tspk s ON s.spk_nomor = h.promin_spk_nomor
      LEFT JOIN tmemospk m ON m.mspk_nomor = h.promin_spk_nomor
      ${where}
      GROUP BY h.promin_nomor
    ) x
    WHERE ROUND(x.JmlMinta - (x.JmlLhk + x.JmlCmt), 2) <> 0
    ORDER BY x.Nomor
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per baris bahan dalam satu Permintaan Bahan (Nomor).
// CATATAN: Delphi tidak filter cab/spk di detail (query-nya cuma
// filter periode tanggal, karena MasterKeyField='Nomor' otomatis
// bikin framework nge-filter detail per baris master yang di-expand).
// Di web, kita filter eksplisit by Nomor karena tidak ada mekanisme
// serupa.
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const sql = `
    SELECT x.*, (x.JmlLhk + x.JmlCmt) AS TotalPotong,
      (x.JmlMinta - (x.JmlLhk + x.JmlCmt)) AS Sisa
    FROM (
      SELECT
        d.promind_promin_Nomor AS Nomor,
        d.promind_bhn_kode AS Kode,
        b.Bhn_Name AS Nama,
        b.Bhn_satuan AS Satuan,
        d.promind_Jumlah AS JmlMinta,
        IFNULL((
          SELECT SUM(j.mph_qty_berat) FROM tmutasiproduksi_hdr j
          WHERE j.mph_nomaterial = d.promind_promin_Nomor
            AND j.mph_bhn_kode = d.promind_bhn_kode
        ), 0) AS JmlLhk,
        IFNULL((
          SELECT SUM(j.bpj_qty_berat) FROM tbpj_hdr j
          WHERE j.bpj_nomaterial = d.promind_promin_Nomor
            AND j.bpj_bhn_kode = d.promind_bhn_kode
        ), 0) AS JmlCmt
      FROM tproduksiminta_hdr h
      INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
      WHERE d.promind_promin_Nomor = ?
    ) x
    ORDER BY x.Nama
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua permintaan sesuai filter
// master (buat tombol Export Detail)
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, cab = "ALL", spk = "") => {
  const master = await getBrowse(startDate, endDate, cab, spk);
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Nomor);
    for (const d of dtl) {
      result.push({ NamaSpk: m.NamaSpk, Spk: m.Spk, Tujuan: m.Tujuan, ...d });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
