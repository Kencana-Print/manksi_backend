const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — UNION tspk (SPK) + tmemospk (MAP), keduanya harus punya
// row di tmkb_hdr. Quirk dipertahankan: filter MKB_TANGGAL cuma
// >= startDate (TANPA batas atas/endDate) — persis Delphi asli.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const sql = `
    SELECT x.* FROM (
      SELECT
        s.spk_nomor AS Nomor,
        DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tglspk,
        DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
        s.spk_nama AS NamaSPK,
        s.spk_jumlah AS JmlSpk
      FROM tspk s
      WHERE s.spk_tanggal >= ? AND s.spk_tanggal <= ?
        AND s.spk_nomor IN (
          SELECT k.MKB_SPK_NOMOR FROM tmkb_hdr k WHERE k.MKB_TANGGAL >= ?
        )
      UNION ALL
      SELECT
        m.mspk_nomor AS Nomor,
        DATE_FORMAT(m.mspk_tanggal, '%Y-%m-%d') AS Tglspk,
        DATE_FORMAT(m.mspk_dateline, '%Y-%m-%d') AS Dateline,
        m.mspk_nama AS NamaSPK,
        m.mspk_jumlah AS JmlSpk
      FROM tmemospk m
      WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
        AND m.mspk_nomor IN (
          SELECT k.MKB_SPK_NOMOR FROM tmkb_hdr k WHERE k.MKB_TANGGAL >= ?
        )
    ) x
    ORDER BY x.Tglspk
  `;
  const [rows] = await db.query(sql, [
    startDate,
    endDate,
    startDate,
    startDate,
    endDate,
    startDate,
  ]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per SPK/MAP, satu baris per (MKB, Kode Bahan). Difilter
// eksplisit by nomor (web tidak punya mekanisme master-detail
// otomatis seperti cxGrid Delphi).
// ✅ BUG FIXED (sesuai konfirmasi): BPBnonPo sekarang match
// dd.bpbd_bhn_kode = d.mkbd_bhn_kode (bukan mkbd_jumlah).
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  const sql = `
    SELECT x.*, (x.Butuh - (x.Ready + x.Bpb + x.BpbNonPo)) AS Kurang
    FROM (
      SELECT
        IFNULL(sp.spk_nomor, mm.mspk_nomor) AS Nomor,
        h.MKB_NOMOR AS Mkb,
        DATE_FORMAT(h.MKB_TANGGAL, '%Y-%m-%d') AS TglMkb,
        b.Bhn_kode AS Kode,
        b.Bhn_Name AS NamaBahan,
        b.Bhn_satuan AS Satuan,
        d.mkbd_jumlah AS Butuh,
        d.mkbd_jumlah_RS AS Ready,
        d.mkbd_jumlah_PO AS AkanPo,
        IFNULL((
          SELECT SUM(pd.pod_jumlah) FROM tpo_dtl pd
          WHERE pd.pod_spk_nomor = h.MKB_SPK_NOMOR AND pd.pod_bhn_kode = b.Bhn_kode
        ), 0) AS SudahPo,
        IFNULL((
          SELECT SUM(dd.bpbd_Jumlah) FROM tbpb_dtl dd
          INNER JOIN tbpb_hdr hh ON hh.bpb_Nomor = dd.bpbd_bpb_Nomor
          WHERE hh.bpb_po_Nomor = i.pod_po_Nomor AND dd.bpbd_bhn_kode = i.pod_bhn_kode
        ), 0) AS Bpb,
        IFNULL((
          SELECT SUM(dd.bpbd_Jumlah) FROM tbpb_dtl dd
          INNER JOIN tbpb_hdr hh ON hh.bpb_Nomor = dd.bpbd_bpb_Nomor
          WHERE hh.bpb_po_Nomor = '' AND dd.bpbd_mkb = h.MKB_NOMOR
            AND dd.bpbd_bhn_kode = d.mkbd_bhn_kode
        ), 0) AS BpbNonPo
      FROM tmkb_hdr h
      INNER JOIN tmkb_dtl d ON h.MKB_NOMOR = d.mkbd_mkb_nomor
      LEFT JOIN tpo_dtl i ON i.pod_mkb_nomor = d.mkbd_mkb_nomor AND i.pod_bhn_kode = d.mkbd_bhn_kode
      INNER JOIN tbahan b ON b.Bhn_kode = d.mkbd_bhn_kode
      LEFT JOIN tspk sp ON sp.spk_nomor = h.MKB_SPK_NOMOR
      LEFT JOIN tmemospk mm ON mm.mspk_nomor = h.MKB_SPK_NOMOR
      WHERE h.MKB_SPK_NOMOR = ?
    ) x
    ORDER BY x.Mkb, x.Kode
  `;
  const [rows] = await db.query(sql, [nomor]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua SPK sesuai filter master
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate) => {
  const master = await getBrowse(startDate, endDate);
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Nomor);
    for (const d of dtl) {
      result.push({ NamaSPK: m.NamaSPK, Tglspk: m.Tglspk, ...d });
    }
  }
  return result;
};

// ─────────────────────────────────────────────
// EXPORT CASCADE — replikasi struktur nested tombol "Export to
// Excel" Delphi: SPK → MKB (per bahan) → PO (grouped) → BPB (per PO)
// + BPBnonPO (per MKB/bahan, di luar loop PO).
// ✅ BUG FIXED (sesuai konfirmasi): BPB per PO sekarang match nomor
// PO yang benar (poNomor), bukan salah ambil dari nomor MKB.
// ✅ BUG FIXED: BPBnonPO match mkbd_bhn_kode (sama seperti getDetail).
// ─────────────────────────────────────────────
const getMkbRows = async (spkNomor) => {
  const sql = `
    SELECT
      h.MKB_NOMOR AS MkbNomor,
      DATE_FORMAT(h.MKB_TANGGAL, '%Y-%m-%d') AS TglMkb,
      d.mkbd_bhn_kode AS Kode,
      b.Bhn_Name AS NamaBahan,
      b.Bhn_satuan AS Satuan,
      d.mkbd_jumlah AS Butuh,
      d.mkbd_jumlah_RS AS Ready,
      d.mkbd_jumlah_PO AS AkanPo
    FROM tmkb_hdr h
    INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.MKB_NOMOR
    LEFT JOIN tbahan b ON b.Bhn_kode = d.mkbd_bhn_kode
    WHERE h.MKB_SPK_NOMOR = ?
  `;
  const [rows] = await db.query(sql, [spkNomor]);
  return rows;
};

const getPoRows = async (spkNomor, kode) => {
  const sql = `
    SELECT h.po_nomor AS PoNomor,
      DATE_FORMAT(h.po_tanggal, '%Y-%m-%d') AS TglPo,
      SUM(d.pod_Jumlah) AS JmlPo
    FROM tpo_hdr h
    LEFT JOIN tpo_dtl d ON d.pod_po_nomor = h.po_nomor
    WHERE d.pod_spk_nomor = ? AND d.pod_bhn_kode = ?
    GROUP BY h.po_nomor
    ORDER BY h.po_tanggal
  `;
  const [rows] = await db.query(sql, [spkNomor, kode]);
  return rows;
};

const getBpbRowsByPo = async (poNomor, kode) => {
  const sql = `
    SELECT h.bpb_Nomor AS BpbNomor,
      DATE_FORMAT(h.bpb_Tanggal, '%Y-%m-%d') AS TglBpb,
      SUM(d.bpbd_Jumlah) AS JmlBpb
    FROM tbpb_hdr h
    INNER JOIN tbpb_dtl d ON d.bpbd_bpb_Nomor = h.bpb_Nomor
    WHERE h.bpb_po_Nomor = ? AND d.bpbd_bhn_kode = ?
    GROUP BY h.bpb_Nomor
    ORDER BY h.bpb_Tanggal
  `;
  const [rows] = await db.query(sql, [poNomor, kode]);
  return rows;
};

const getBpbNonPoRows = async (mkbNomor, kode) => {
  const sql = `
    SELECT h.bpb_Nomor AS BpbNomor,
      DATE_FORMAT(h.bpb_Tanggal, '%Y-%m-%d') AS TglBpb,
      SUM(d.bpbd_Jumlah) AS JmlBpb
    FROM tbpb_hdr h
    INNER JOIN tbpb_dtl d ON d.bpbd_bpb_Nomor = h.bpb_Nomor
    WHERE h.bpb_po_Nomor = '' AND d.bpbd_mkb = ? AND d.bpbd_bhn_kode = ?
    GROUP BY h.bpb_Nomor
    ORDER BY h.bpb_Tanggal
  `;
  const [rows] = await db.query(sql, [mkbNomor, kode]);
  return rows;
};

const getExportCascade = async (startDate, endDate) => {
  const master = await getBrowse(startDate, endDate);
  const result = [];
  for (const spk of master) {
    const mkbRows = await getMkbRows(spk.Nomor);
    const mkbList = [];
    for (const mkb of mkbRows) {
      const poRows = await getPoRows(spk.Nomor, mkb.Kode);
      const poList = [];
      for (const po of poRows) {
        const bpbRows = await getBpbRowsByPo(po.PoNomor, mkb.Kode);
        poList.push({ ...po, bpbList: bpbRows });
      }
      const bpbNonPoList = await getBpbNonPoRows(mkb.MkbNomor, mkb.Kode);
      mkbList.push({ ...mkb, poList, bpbNonPoList });
    }
    result.push({ ...spk, mkbList });
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
  getExportCascade,
};
