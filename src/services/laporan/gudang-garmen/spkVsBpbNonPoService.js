const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — SPK/MAP distinct dari tbpb_dtl.bpbd_spk_nomor LANGSUNG
// (tanpa lewat tpo_dtl/PO). Ini BPB non-PO — SPK diisi manual di
// detail BPB, bukan hasil link dari PO. Filter tanggal via HAVING.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const sql = `
    SELECT DISTINCT
      IFNULL(sp.spk_nomor, mm.mspk_nomor) AS SpkNomor,
      DATE_FORMAT(IFNULL(sp.spk_tanggal, mm.mspk_tanggal), '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(IFNULL(sp.spk_dateline, mm.mspk_dateline), '%Y-%m-%d') AS Dateline,
      c.cus_nama AS Customer,
      IFNULL(sp.spk_nama, mm.mspk_nama) AS SpkNama,
      IFNULL(sp.spk_kain, mm.mspk_kain) AS Kain,
      IFNULL(sp.spk_finishing, mm.mspk_finishing) AS Finishing,
      IFNULL(sp.spk_jumlah, mm.mspk_jumlah) AS Jumlah
    FROM tbpb_dtl d
    LEFT JOIN tspk sp ON sp.spk_nomor = d.bpbd_spk_nomor
    LEFT JOIN tmemospk mm ON mm.mspk_nomor = d.bpbd_spk_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = IFNULL(sp.spk_cus_kode, mm.mspk_cus_kode)
    WHERE d.bpbd_spk_nomor <> ''
    HAVING Tanggal >= ? AND Tanggal <= ?
  `;
  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per transaksi BPB+bahan untuk satu SPK, langsung dari
// tbpb_dtl (tanpa lewat PO). Difilter eksplisit by bpbd_spk_nomor.
// ─────────────────────────────────────────────
const getDetail = async (spkNomor) => {
  const sql = `
    SELECT
      d.bpbd_spk_nomor AS SpkNomor,
      d.bpbd_bpb_nomor AS NomorBpb,
      DATE_FORMAT(h.BPB_tanggal, '%Y-%m-%d') AS Tanggal,
      d.bpbd_bhn_kode AS Kode,
      b.Bhn_Name AS NamaBahan,
      d.bpbd_bhn_satuan AS Satuan,
      d.bpbd_jumlah AS Jumlah
    FROM tbpb_dtl d
    INNER JOIN tbpb_hdr h ON d.bpbd_bpb_nomor = h.bpb_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.bpbd_bhn_kode
    WHERE d.bpbd_spk_nomor = ?
    ORDER BY d.bpbd_spk_nomor
  `;
  const [rows] = await db.query(sql, [spkNomor]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua SPK sesuai filter master
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate) => {
  const master = await getBrowse(startDate, endDate);
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.SpkNomor);
    for (const d of dtl) {
      result.push({ SpkNama: m.SpkNama, Customer: m.Customer, ...d });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
