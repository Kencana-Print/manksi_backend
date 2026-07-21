const db = require("../../../config/database");

const JASA_KODE_JAHIT = "J02";

// ─────────────────────────────────────────────
// MASTER — rekap per supplier (mitra), hanya Jasa Jahit (J02),
// hanya yang masih ada kekurangan (Kurang > 0).
// OTM = Kurang / sup_targetmitra
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, cab = "ALL") => {
  let where = `WHERE h.pojh_jasa_kode = ? AND h.pojh_tanggal >= ? AND h.pojh_tanggal <= ?`;
  const params = [JASA_KODE_JAHIT, startDate, endDate];
  if (cab && cab !== "ALL") {
    where += ` AND h.pojh_cab = ?`;
    params.push(cab);
  }

  const sql = `
    SELECT x.Kode, x.Supplier, x.Jasa,
      SUM(x.JmlPo) AS Po,
      SUM(x.JmlTerima) AS Terima,
      SUM(x.JmlPo - x.JmlTerima) AS Kurang,
      x.Target,
      IFNULL(SUM(x.JmlPo - x.JmlTerima) / x.Target, 0) AS Otm
    FROM (
      SELECT
        h.pojh_sup_kode AS Kode,
        s.sup_nama AS Supplier,
        s.sup_targetmitra AS Target,
        j.jasa_nama AS Jasa,
        h.pojh_jumlah AS JmlPo,
        IFNULL((SELECT SUM(bpj_jumlah) FROM tbpj_hdr WHERE bpj_po_nomor = h.pojh_nomor), 0) AS JmlTerima
      FROM tpojasa_hdr h
      INNER JOIN tsupplier s ON s.sup_kode = h.pojh_sup_kode
      LEFT JOIN tjasa j ON j.jasa_kode = h.pojh_jasa_kode
      ${where}
    ) x
    WHERE (x.JmlPo - x.JmlTerima) > 0
    GROUP BY x.Kode
    ORDER BY x.Supplier
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per baris PO Jasa untuk satu supplier (Kode), hanya
// yang masih ada kekurangan (sama filter periode/jasa dgn master)
// ─────────────────────────────────────────────
const getDetail = async (kode, startDate, endDate, cab = "ALL") => {
  let where = `WHERE h.pojh_jasa_kode = ? AND h.pojh_tanggal >= ? AND h.pojh_tanggal <= ? AND h.pojh_sup_kode = ?`;
  const params = [JASA_KODE_JAHIT, startDate, endDate, kode];
  if (cab && cab !== "ALL") {
    where += ` AND h.pojh_cab = ?`;
    params.push(cab);
  }

  const sql = `
    SELECT x.Kode, x.Supplier, x.Nomor,
      DATE_FORMAT(x.TanggalPo, '%Y-%m-%d') AS TanggalPo,
      DATE_FORMAT(x.Dateline, '%Y-%m-%d') AS Dateline,
      x.Gudang, x.Jasa, x.Spk, x.Nama,
      x.JmlPo, x.JmlTerima, (x.JmlPo - x.JmlTerima) AS Kurang
    FROM (
      SELECT
        h.pojh_nomor AS Nomor,
        h.pojh_tanggal AS TanggalPo,
        h.pojh_dateline AS Dateline,
        h.pojh_cab AS Gudang,
        h.pojh_sup_kode AS Kode,
        s.sup_nama AS Supplier,
        j.jasa_nama AS Jasa,
        h.pojh_spk_nomor AS Spk,
        IFNULL(sp.spk_nama, mp.mspk_nama) AS Nama,
        h.pojh_jumlah AS JmlPo,
        IFNULL((SELECT SUM(bpj_jumlah) FROM tbpj_hdr WHERE bpj_po_nomor = h.pojh_nomor), 0) AS JmlTerima
      FROM tpojasa_hdr h
      INNER JOIN tsupplier s ON s.sup_kode = h.pojh_sup_kode
      LEFT JOIN tspk sp ON sp.spk_nomor = h.pojh_spk_nomor
      LEFT JOIN tmemospk mp ON mp.mspk_nomor = h.pojh_spk_nomor
      LEFT JOIN tjasa j ON j.jasa_kode = h.pojh_jasa_kode
      ${where}
    ) x
    WHERE (x.JmlPo - x.JmlTerima) > 0
    ORDER BY x.Kode, x.Nomor
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua supplier sesuai filter master
// (buat tombol Export Detail)
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, cab = "ALL") => {
  const master = await getBrowse(startDate, endDate, cab);
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Kode, startDate, endDate, cab);
    result.push(...dtl);
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
