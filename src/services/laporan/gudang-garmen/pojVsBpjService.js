const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — PO Jasa + info supplier/SPK/jasa/gudang.
// Filter: periode tanggal PO, gudang (kosong=semua, P01/P04 — pakai
// pojh_cab langsung, bukan turunan dari tjasa), nomor PO (LIKE prefix).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, gudang = "", spk = "") => {
  let where = `WHERE h.pojh_tanggal >= ? AND h.pojh_tanggal <= ?`;
  const params = [startDate, endDate];

  if (spk) {
    where += ` AND h.pojh_spk_nomor = ?`;
    params.push(spk);
  }
  if (gudang) {
    where += ` AND h.pojh_cab = ?`;
    params.push(gudang);
  }

  const sql = `
    SELECT
      h.pojh_nomor AS Nomor,
      DATE_FORMAT(h.pojh_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(h.pojh_dateline, '%Y-%m-%d') AS Dateline,
      h.pojh_cab AS Gudang,
      h.pojh_sup_kode AS Kode,
      s.sup_nama AS Supplier,
      j.jasa_nama AS Jasa,
      h.pojh_spk_nomor AS Spk,
      sp.spk_nama AS Nama,
      h.pojh_jumlah AS JmlPo,
      h.pojh_jumlah_terima AS JmlTerima,
      (h.pojh_jumlah - h.pojh_jumlah_terima) AS Kurang,
      h.pojh_tarif AS Tarif,
      (h.pojh_jumlah * h.pojh_tarif) AS TotPo,
      (h.pojh_jumlah_terima * h.pojh_tarif) AS TotTerima,
      ((h.pojh_jumlah - h.pojh_jumlah_terima) * h.pojh_tarif) AS TotKurang,
      IFNULL(bpj.NomorBpjList, '-') AS NomorBpjList,
      IFNULL(bpj.TanggalBpjList, '-') AS TanggalBpjList,
      IFNULL(bpj.JatuhTempoBpjList, '-') AS JatuhTempoBpjList,
      IFNULL(bpj.JumlahBpjList, '-') AS JumlahBpjList,
      (IFNULL(bpj.TotalBayarBpj, 0) * h.pojh_tarif) AS TotalBayarBpj
    FROM tpojasa_hdr h
    INNER JOIN tsupplier s ON s.sup_kode = h.pojh_sup_kode
    INNER JOIN tspk sp ON sp.spk_nomor = h.pojh_spk_nomor
    LEFT JOIN tjasa j ON j.jasa_kode = h.pojh_jasa_kode
    LEFT JOIN (
      SELECT
        bpj_po_nomor,
        GROUP_CONCAT(bpj_nomor ORDER BY bpj_tanggal, bpj_nomor SEPARATOR ', ') AS NomorBpjList,
        GROUP_CONCAT(DATE_FORMAT(bpj_tanggal, '%d-%m-%Y') ORDER BY bpj_tanggal, bpj_nomor SEPARATOR ', ') AS TanggalBpjList,
        GROUP_CONCAT(DATE_FORMAT(bpj_jatuhtempo, '%d-%m-%Y') ORDER BY bpj_tanggal, bpj_nomor SEPARATOR ', ') AS JatuhTempoBpjList,
        GROUP_CONCAT(FORMAT(bpj_jumlah, 0) ORDER BY bpj_tanggal, bpj_nomor SEPARATOR ', ') AS JumlahBpjList,
        SUM(bpj_jumlah) AS TotalBayarBpj
      FROM tbpj_hdr
      GROUP BY bpj_po_nomor
    ) bpj ON bpj.bpj_po_nomor = h.pojh_nomor
    ${where}
    ORDER BY h.pojh_tanggal, h.pojh_nomor
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — realisasi BPJ per PO Jasa (persis ClientDataSet2 Delphi)
// ─────────────────────────────────────────────
const getDetail = async (nomorPo) => {
  const sql = `
    SELECT
      bpj_nomor AS NomorBpj,
      DATE_FORMAT(bpj_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(bpj_jatuhtempo, '%Y-%m-%d') AS JatuhTempo,
      bpj_jumlah AS Jumlah
    FROM tbpj_hdr
    WHERE bpj_po_nomor = ?
    ORDER BY bpj_tanggal, bpj_nomor
  `;
  const [rows] = await db.query(sql, [nomorPo]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — untuk Export (gabungan master + detail per baris,
// sesuai struktur Excel export Delphi: satu PO bisa punya banyak
// baris BPJ, ditumpuk vertikal di bawahnya)
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, gudang = "", spk = "") => {
  const master = await getBrowse(startDate, endDate, gudang, spk);
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Nomor);
    if (dtl.length === 0) {
      result.push({ ...m });
    } else {
      for (const d of dtl) {
        result.push({ ...m, ...d });
      }
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
