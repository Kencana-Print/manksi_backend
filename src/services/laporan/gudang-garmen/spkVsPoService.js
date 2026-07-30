const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — SPK/MAP distinct yang punya minimal 1 baris PO
// (pod_spk_nomor terisi). Filter tanggal pakai HAVING (alias
// Tanggal), persis replikasi Delphi.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, canLihatCus = false) => {
  const custCol = canLihatCus ? "c.cus_nama AS Customer," : `"" AS Customer,`;
  const sql = `
    SELECT DISTINCT
      IFNULL(sp.spk_nomor, mm.mspk_nomor) AS SpkNomor,
      DATE_FORMAT(IFNULL(sp.spk_tanggal, mm.mspk_tanggal), '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(IFNULL(sp.spk_dateline, mm.mspk_dateline), '%Y-%m-%d') AS Dateline,
      ${custCol}
      IFNULL(sp.spk_nama, mm.mspk_nama) AS SpkNama,
      IFNULL(sp.spk_kain, mm.mspk_kain) AS Kain,
      IFNULL(sp.spk_finishing, mm.mspk_finishing) AS Finishing,
      IFNULL(sp.spk_jumlah, mm.mspk_jumlah) AS Jumlah
    FROM tpo_dtl d
    LEFT JOIN tspk sp ON sp.spk_nomor = d.pod_spk_nomor
    LEFT JOIN tmemospk mm ON mm.mspk_nomor = d.pod_spk_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = IFNULL(sp.spk_cus_kode, mm.mspk_cus_kode)
    WHERE d.pod_spk_nomor <> ''
    HAVING Tanggal >= ? AND Tanggal <= ?
  `;
  const [rows] = await db.query(sql, [startDate, endDate]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per PO+bahan untuk satu SPK. Difilter eksplisit by
// pod_spk_nomor (web tidak punya mekanisme master-detail otomatis
// cxGrid). Terima dihitung dari BPB yang bpb_po_Nomor = PO ini.
// ─────────────────────────────────────────────
const getDetail = async (spkNomor) => {
  const sql = `
    SELECT
      d.pod_spk_nomor AS SpkNomor,
      d.pod_po_nomor AS NomorPo,
      DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS Tanggal,
      d.pod_bhn_kode AS Kode,
      b.Bhn_Name AS NamaBahan,
      d.pod_bhn_satuan AS Satuan,
      d.pod_jumlah AS Jumlah,
      IFNULL((
        SELECT SUM(dd.bpbd_Jumlah) FROM tbpb_dtl dd
        INNER JOIN tbpb_hdr hh ON hh.bpb_Nomor = dd.bpbd_bpb_Nomor
        WHERE hh.bpb_po_Nomor = h.po_Nomor AND dd.bpbd_bhn_kode = d.pod_bhn_kode
      ), 0) AS Terima
    FROM tpo_dtl d
    INNER JOIN tpo_hdr h ON d.pod_po_nomor = h.po_nomor
    INNER JOIN tbahan b ON b.Bhn_kode = d.pod_bhn_kode
    WHERE d.pod_spk_nomor = ?
    ORDER BY d.pod_po_nomor
  `;
  const [rows] = await db.query(sql, [spkNomor]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua SPK sesuai filter master
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, canLihatCus = false) => {
  const master = await getBrowse(startDate, endDate, canLihatCus);
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
