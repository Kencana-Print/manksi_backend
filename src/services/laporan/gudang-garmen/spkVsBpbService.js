const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — SPK/MAP distinct yang PO-nya SUDAH ADA BPB (INNER JOIN
// tbpb_hdr ON pod_po_nomor=bpb_po_nomor). Beda dari SPK vs PO (520)
// yang menampilkan SPK meski PO-nya belum ada BPB sama sekali.
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
    INNER JOIN tbpb_hdr bh ON d.pod_po_nomor = bh.bpb_po_nomor
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
// DETAIL — per transaksi BPB+bahan untuk satu SPK. Rangkaian join
// persis Delphi: tpo_dtl → tpo_hdr → tbpb_hdr (by po_nomor) →
// tbpb_dtl (by bpb_nomor DAN bhn_kode) → tbahan. Difilter eksplisit
// by pod_spk_nomor (web tidak punya mekanisme master-detail cxGrid).
// ─────────────────────────────────────────────
const getDetail = async (spkNomor) => {
  const sql = `
    SELECT
      d.pod_spk_nomor AS SpkNomor,
      bd.bpbd_bpb_nomor AS NomorBpb,
      DATE_FORMAT(bh.BPB_tanggal, '%Y-%m-%d') AS Tanggal,
      bd.bpbd_bhn_kode AS Kode,
      b.Bhn_Name AS NamaBahan,
      bd.bpbd_bhn_satuan AS Satuan,
      bd.bpbd_jumlah AS Jumlah
    FROM tpo_dtl d
    INNER JOIN tpo_hdr h ON d.pod_po_nomor = h.po_nomor
    INNER JOIN tbpb_hdr bh ON bh.bpb_po_nomor = h.po_nomor
    INNER JOIN tbpb_dtl bd ON bd.bpbd_bpb_nomor = bh.bpb_nomor
      AND bd.bpbd_bhn_kode = d.pod_bhn_kode
    INNER JOIN tbahan b ON b.Bhn_kode = d.pod_bhn_kode
    WHERE d.pod_spk_nomor = ?
    ORDER BY d.pod_spk_nomor
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
