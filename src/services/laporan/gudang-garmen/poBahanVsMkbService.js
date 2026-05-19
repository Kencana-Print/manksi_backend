const db = require("../../../config/database");

// --- 1. GET BROWSE HEADER (Master PO) ---
const getBrowse = async (query) => {
  const { startDate, endDate, supplier } = query;

  // Default tanggal: Hari ini (Sesuai refreshdata di Delphi)
  const dStart = startDate || new Date().toISOString().substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  let sql = `
    SELECT 
      h.po_Nomor AS Nomor,
      DATE_FORMAT(h.po_Tanggal, "%Y-%m-%d") AS Tanggal,
      h.po_sup_kode AS KodeSupplier,
      s.Sup_nama AS NamaSupplier,
      h.po_Keterangan AS Keterangan
    FROM tpo_hdr h
    LEFT JOIN tsupplier s ON s.Sup_kode = h.po_sup_kode
    WHERE h.po_jenis <> 1 
      AND h.po_Tanggal >= ? AND h.po_Tanggal <= ?
  `;

  const params = [dStart, dEnd];

  // Jika filter kode supplier diisi
  if (supplier) {
    sql += ` AND h.po_sup_kode = ?`;
    params.push(supplier);
  }

  sql += ` ORDER BY h.po_Nomor DESC`;

  const [rows] = await db.query(sql, params);
  return rows;
};

// --- 2. GET BROWSE DETAIL (Detail Bahan dalam PO) ---
const getBrowseDetail = async (nomorPO) => {
  const sql = `
    SELECT 
      x.kode AS KodeBahan,
      x.NamaBahan,
      x.Satuan,
      x.JmlPO,
      (x.po1 + x.po2) AS AkanPO,
      (x.JmlPO - (x.po1 + x.po2)) AS Sisa,
      x.pod_nourut AS UrutPO,
      x.pod_mkb_nomor AS NomorMKB_Utama
    FROM (
      SELECT 
        d.pod_bhn_kode AS kode,
        b.Bhn_Name AS NamaBahan,
        b.Bhn_satuan AS Satuan,
        d.pod_Jumlah AS JmlPO,
        d.pod_nourut,
        d.pod_mkb_nomor,
        IFNULL((
          SELECT SUM(p.mkbd_jumlah_PO) 
          FROM tmkb_dtl p 
          WHERE p.mkbd_mkb_nomor = d.pod_mkb_nomor 
            AND p.mkbd_bhn_kode = d.pod_bhn_kode
        ), 0) AS po1,
        IFNULL((
          SELECT SUM(p.mkbd_jumlah_PO) 
          FROM tmkb_dtl2 o 
          LEFT JOIN tmkb_dtl p ON p.mkbd_mkb_nomor = o.mkbd2_mkb_nomor 
                              AND p.mkbd_nourut = o.mkbd2_nourut
          WHERE o.mkbd2_po_nomor = d.pod_po_nomor 
            AND o.mkbd2_pourut = d.pod_nourut
        ), 0) AS po2
      FROM tpo_dtl d
      LEFT JOIN tpo_hdr h ON h.po_Nomor = d.pod_po_nomor
      LEFT JOIN tbahan b ON b.Bhn_kode = d.pod_bhn_kode
      WHERE d.pod_po_nomor = ?
      ORDER BY d.pod_po_Nomor
    ) x
  `;

  const [rows] = await db.query(sql, [nomorPO]);
  return rows;
};

// --- 3. GET MKB LINKED TO DETAIL (Sub-detail MKB) ---
const getSubDetailMkb = async (nomorPO, urutPO, kodeBahan, nomorMkbUtama) => {
  let sql = `
    SELECT 
      o.mkbd2_mkb_nomor AS NomorMKB,
      DATE_FORMAT(q.MKB_TANGGAL, "%Y-%m-%d") AS TanggalMKB,
      p.mkbd_jumlah_PO AS AkanPO
    FROM tmkb_dtl2 o
    LEFT JOIN tmkb_dtl p ON p.mkbd_mkb_nomor = o.mkbd2_mkb_nomor AND p.mkbd_nourut = o.mkbd2_nourut
    LEFT JOIN tmkb_hdr q ON q.MKB_NOMOR = o.mkbd2_mkb_nomor
    WHERE o.mkbd2_po_nomor = ? AND o.mkbd2_pourut = ?
  `;
  const params = [nomorPO, urutPO];

  if (nomorMkbUtama) {
    sql += `
      UNION ALL
      SELECT 
        d.pod_mkb_nomor AS NomorMKB,
        DATE_FORMAT(j.MKB_TANGGAL, "%Y-%m-%d") AS TanggalMKB,
        i.mkbd_jumlah_PO AS AkanPO
      FROM tpo_dtl d
      LEFT JOIN tmkb_dtl i ON i.mkbd_mkb_nomor = d.pod_mkb_nomor AND i.mkbd_bhn_kode = d.pod_bhn_kode
      LEFT JOIN tmkb_hdr j ON j.MKB_NOMOR = i.mkbd_mkb_nomor
      WHERE d.pod_mkb_nomor = ? 
        AND d.pod_po_Nomor = ? 
        AND d.pod_bhn_kode = ?
    `;
    params.push(nomorMkbUtama, nomorPO, kodeBahan);
  }

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getSubDetailMkb,
};
