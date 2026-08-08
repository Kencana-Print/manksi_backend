const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — satu baris per SPK/MAP (bukan per Nomor Minta).
// Sumber tabel toggle via isMap: true → tmemospk, false → tspk (aktif='Y').
// Lhk dihitung LANGSUNG per SPK (mph_spk_nomor), dibatasi gudang asal
// GP001/GP015 (quirk Delphi — kemungkinan gudang cutting P01/P04).
// Cmt dihitung per SPK via tpojasa_hdr.pojh_spk_nomor.
// ⚠️ Kolom `Divisi` (td.Divisi) belum terverifikasi — cek
// `SHOW COLUMNS FROM tdivisi` sebelum dipakai di production.
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// BROWSE MAP
// ─────────────────────────────────────────────
const getBrowseMap = async (
  startDate,
  endDate,
  spkPrefix,
  canLihatCus = false,
  namaBahan = "",
) => {
  const custCol = canLihatCus ? "c.cus_nama AS Customer," : `"" AS Customer,`;

  // 1. Filter Bahan (Sub-query)
  const bahanFilter = namaBahan
    ? `AND EXISTS (
        SELECT 1 FROM tproduksiminta_hdr h2
        INNER JOIN tproduksiminta_dtl d2 ON d2.promind_promin_Nomor = h2.promin_nomor
        WHERE h2.promin_spk_nomor = s.mspk_nomor
          AND d2.promind_bhn_kode = ?   
    )`
    : "";

  const sql = `
    SELECT x.*, (x.TotMinta - x.TotRetur) AS NetMinta, (x.Lhk + x.Cmt) AS TotLhk
    FROM (
      SELECT
        s.mspk_nomor AS Spk,
        td.Divisi AS Divisi,
        s.spk_workshop AS Workshop,
        DATE_FORMAT(s.mspk_dateline, '%d-%m-%Y') AS Dateline,
        s.mspk_nama AS Nama,
        s.mspk_ukuran AS Ukuran,
        ${custCol}
        s.mspk_jo_kode AS Jenis,
        s.mspk_kain AS Kain,
        s.mspk_jumlah AS JmlOrder,
        IFNULL((
          SELECT SUM(d.promind_Jumlah) FROM tproduksiminta_hdr h
          INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
          WHERE h.promin_spk_nomor = s.mspk_nomor
        ), 0) AS TotMinta,
        (SELECT IFNULL(SUM(r.proretd_Jumlah), 0) FROM tproduksiretur_dtl r
          WHERE r.proretd_spk = s.mspk_nomor) AS TotRetur,
        IFNULL((
          SELECT SUM(h.mph_qty_berat) FROM tmutasiproduksi_hdr h
          WHERE h.mph_spk_nomor = s.mspk_nomor
            AND (h.mph_gdgasal = 'GP001' OR h.mph_gdgasal = 'GP015')
            AND h.mph_nomaterial <> ''
        ), 0) AS Lhk,
        IFNULL((
          SELECT SUM(j.bpj_qty_berat) FROM tbpj_hdr j
          LEFT JOIN tpojasa_hdr h ON h.pojh_nomor = j.bpj_po_Nomor
          WHERE j.bpj_nomaterial <> '' AND h.pojh_spk_nomor = s.mspk_nomor
        ), 0) AS Cmt,
        s.mspk_tanggal AS _sortTgl
      FROM tmemospk s
      INNER JOIN tcustomer c ON s.mspk_cus_kode = c.cus_kode
      LEFT JOIN tsales sl ON sl.sal_kode = s.spk_sal_kode
      LEFT JOIN tdivisi td ON td.kode = s.spk_divisi
      WHERE s.mspk_divisi IN (3, 4, 6)
        AND s.mspk_nomor LIKE ?
        AND s.mspk_tanggal >= ? AND s.mspk_tanggal <= ?
        ${bahanFilter} /* 2. INJEKSI FILTER BAHAN */
    ) x
    ORDER BY x._sortTgl
  `;

  // 3. Masukkan parameter (termasuk filter jam)
  const params = [
    `${spkPrefix}%`,
    `${startDate} 00:00:00`,
    `${endDate} 23:59:59`,
  ];
  if (namaBahan) params.push(namaBahan);

  const [rows] = await db.query(sql, params);
  return rows.map(({ _sortTgl, ...r }) => r);
};

// ─────────────────────────────────────────────
// BROWSE SPK
// ─────────────────────────────────────────────
const getBrowseSpk = async (
  startDate,
  endDate,
  spkPrefix,
  canLihatCus = false,
  namaBahan = "",
) => {
  const custCol = canLihatCus ? "c.cus_nama AS Customer," : `"" AS Customer,`;

  // 1. Filter Bahan (Sub-query)
  const bahanFilter = namaBahan
    ? `AND EXISTS (
        SELECT 1 FROM tproduksiminta_hdr h2
        INNER JOIN tproduksiminta_dtl d2 ON d2.promind_promin_Nomor = h2.promin_nomor
        WHERE h2.promin_spk_nomor = s.spk_nomor
          AND d2.promind_bhn_kode = ?   
    )`
    : "";

  const sql = `
    SELECT x.*, (x.TotMinta - x.TotRetur) AS NetMinta, (x.Lhk + x.Cmt) AS TotLhk
    FROM (
      SELECT
        s.spk_nomor AS Spk,
        td.Divisi AS Divisi,
        s.spk_workshop AS Workshop,
        DATE_FORMAT(s.spk_dateline, '%d-%m-%Y') AS Dateline,
        s.spk_nama AS Nama,
        s.spk_ukuran AS Ukuran,
        ${custCol}
        s.spk_jo_kode AS Jenis,
        s.spk_kain AS Kain,
        s.spk_jumlah AS JmlOrder,
        IFNULL((
          SELECT SUM(d.promind_Jumlah) FROM tproduksiminta_hdr h
          INNER JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
          WHERE h.promin_spk_nomor = s.spk_nomor
        ), 0) AS TotMinta,
        (SELECT IFNULL(SUM(r.proretd_Jumlah), 0) FROM tproduksiretur_dtl r
          WHERE r.proretd_spk = s.spk_nomor) AS TotRetur,
        IFNULL((
          SELECT SUM(h.mph_qty_berat) FROM tmutasiproduksi_hdr h
          WHERE h.mph_spk_nomor = s.spk_nomor
            AND (h.mph_gdgasal = 'GP001' OR h.mph_gdgasal = 'GP015')
            AND h.mph_nomaterial <> ''
        ), 0) AS Lhk,
        IFNULL((
          SELECT SUM(j.bpj_qty_berat) FROM tbpj_hdr j
          LEFT JOIN tpojasa_hdr h ON h.pojh_nomor = j.bpj_po_Nomor
          WHERE j.bpj_nomaterial <> '' AND h.pojh_spk_nomor = s.spk_nomor
        ), 0) AS Cmt,
        s.spk_tanggal AS _sortTgl
      FROM tspk s
      INNER JOIN tcustomer c ON s.spk_cus_kode = c.cus_kode
      LEFT JOIN tsales sl ON sl.sal_kode = s.spk_sal_kode
      LEFT JOIN tdivisi td ON td.kode = s.spk_divisi
      WHERE s.spk_divisi IN (3, 4, 6)
        AND s.spk_aktif = 'Y'
        AND s.spk_nomor LIKE ?
        AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
        ${bahanFilter} /* 2. INJEKSI FILTER BAHAN */
    ) x
    ORDER BY x._sortTgl
  `;

  // 3. Masukkan parameter (termasuk filter jam)
  const params = [
    `${spkPrefix}%`,
    `${startDate} 00:00:00`,
    `${endDate} 23:59:59`,
  ];
  if (namaBahan) params.push(namaBahan);

  const [rows] = await db.query(sql, params);
  return rows.map(({ _sortTgl, ...r }) => r);
};

const getBrowse = async (
  startDate,
  endDate,
  spk = "",
  isMap = false,
  canLihatCus = false,
  namaBahan = "",
) =>
  isMap
    ? getBrowseMap(startDate, endDate, spk, canLihatCus)
    : getBrowseSpk(startDate, endDate, spk, canLihatCus);

// ─────────────────────────────────────────────
// DETAIL — per (NoMinta, KodeBahan) untuk satu SPK, dengan mutasi
// (LHK+CMT) DI-AGREGAT (SUM+GROUP_CONCAT) per (NoMinta,Kode) — beda
// dari laporan 568 yang satu baris per transaksi.
// ⚠️ QUIRK WAJIB DIPERTAHANKAN: join MKB HANYA by SPK (bukan by
// bahan) — persis replikasi baris `AND i.mkbd_bhn_kode=a.KodeBahan`
// yang di-comment-out di Delphi. QtyMkb/BabaranMkb = TOTAL SEMUA
// bahan di SPK tsb, bukan per-bahan. Jangan "diperbaiki".
// ─────────────────────────────────────────────
const getDetail = async (spk, canLihatCus = false) => {
  const supplierCol = canLihatCus
    ? "x.Sup_nama AS Supplier,"
    : `"" AS Supplier,`;
  const sql = `
    SELECT
      x.Spk,
      x.NoMinta,
      DATE_FORMAT(x.promin_tanggal, '%Y-%m-%d') AS TglMinta,
      x.Gudang,
      x.Tujuan,
      x.promind_bhn_kode AS KodeBahan,
      x.Bhn_Name AS NamaBahan,
      x.Satuan,
      x.Jumlah AS JmlMinta,
      x.retur AS JmlRetur,
      (x.Jumlah - x.retur) AS NetMinta,
      m.nomor AS NoMutasi,
      DATE_FORMAT(m.tgl, '%Y-%m-%d') AS TglMutasi,
      IFNULL(m.jml, 0) AS Potong,
      IFNULL(m.berat, 0) AS Berat,
      ((x.Jumlah - x.retur) - IFNULL(m.berat, 0)) AS SisaBahan,
      IF(m.jml IS NULL OR m.berat IS NULL, 0,
        IF(m.sat = 'KG', m.jml / m.berat, m.berat / m.jml)) AS Babaran,
      IFNULL(mlhk.berat, 0) AS BeratLhk,   -- ← BARU: replikasi persis filter Lhk+Cmt master
      ${supplierCol}
      y.Mkb AS NoMkb,
      DATE_FORMAT(y.TglMkb, '%Y-%m-%d') AS TglMkb,
      IFNULL(y.QtyMkb, 0) AS QtyMkb,
      IFNULL(y.BabaranMkb, 0) AS BabaranMkb
    FROM (
      SELECT
        h.promin_spk_nomor AS Spk,
        h.promin_nomor AS NoMinta,
        h.promin_tanggal,
        g.gdg_nama AS Gudang,
        RIGHT(p.gdgp_nama, LENGTH(p.gdgp_nama) - 6) AS Tujuan,
        d.promind_bhn_kode,
        b.Bhn_Name,
        b.bhn_satuan AS Satuan,
        SUM(d.promind_Jumlah) AS Jumlah,
        s.Sup_nama,
        (SELECT IFNULL(SUM(r.proretd_Jumlah), 0) FROM tproduksiretur_dtl r
          WHERE r.proretd_nominta = h.promin_nomor
            AND r.proretd_bhn_kode = d.promind_bhn_kode) AS retur
      FROM tproduksiminta_hdr h
      LEFT JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
      LEFT JOIN tsupplier s ON s.sup_kode = d.promind_sup_kode
      LEFT JOIN tgudang g ON g.gdg_kode = h.promin_gdg_asal
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.promin_gdgp_kode
      LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
      WHERE h.promin_spk_nomor = ?
      GROUP BY h.promin_nomor, d.promind_bhn_kode
    ) x
    LEFT JOIN (
      SELECT
        CAST(GROUP_CONCAT(v.nomor SEPARATOR ', ') AS CHAR) AS nomor,
        v.tgl, v.kode, SUM(v.jml) AS jml, SUM(v.berat) AS berat, v.sat, v.mat, v.apv
      FROM (
        SELECT m.mph_nomor AS nomor, m.mph_tanggal AS tgl, m.mph_jumlah AS jml,
          m.mph_qty_berat AS berat, m.mph_sat_berat AS sat,
          m.mph_bhn_kode AS kode, m.mph_nomaterial AS mat, m.mph_apv AS apv
        FROM tmutasiproduksi_hdr m WHERE m.mph_nomaterial <> ''
        UNION ALL
        SELECT j.bpj_Nomor AS nomor, j.bpj_tanggal AS tgl, j.bpj_jumlah AS jml,
          j.bpj_qty_berat AS berat, j.bpj_sat_berat AS sat,
          j.bpj_bhn_kode AS kode, j.bpj_nomaterial AS mat, '' AS apv
        FROM tbpj_hdr j WHERE j.bpj_nomaterial <> ''
      ) v
      GROUP BY v.mat, v.kode
    ) m ON m.mat = x.NoMinta AND m.kode = x.promind_bhn_kode
    -- ↓ BARU: join kedua, khusus utk kolom BeratLhk (match filter master persis)
    LEFT JOIN (
      SELECT
        v.mat, v.kode, SUM(v.berat) AS berat
      FROM (
        SELECT m.mph_qty_berat AS berat, m.mph_bhn_kode AS kode, m.mph_nomaterial AS mat
        FROM tmutasiproduksi_hdr m
        WHERE m.mph_nomaterial <> ''
          AND (m.mph_gdgasal = 'GP001' OR m.mph_gdgasal = 'GP015')  -- ← filter Lhk
        UNION ALL
        SELECT j.bpj_qty_berat AS berat, j.bpj_bhn_kode AS kode, j.bpj_nomaterial AS mat
        FROM tbpj_hdr j
        WHERE j.bpj_nomaterial <> ''   -- Cmt tetap tanpa filter gudang, sama seperti master
      ) v
      GROUP BY v.mat, v.kode
    ) mlhk ON mlhk.mat = x.NoMinta AND mlhk.kode = x.promind_bhn_kode
    LEFT JOIN (
      SELECT j.MKB_NOMOR AS Mkb, j.MKB_TANGGAL AS TglMkb, j.MKB_SPK_NOMOR,
        SUM(i.mkbd_jumlah) AS QtyMkb, SUM(i.mkbd_babaran) AS BabaranMkb
      FROM tmkb_hdr j
      INNER JOIN tmkb_dtl i ON i.mkbd_mkb_nomor = j.MKB_NOMOR
      GROUP BY j.MKB_SPK_NOMOR
    ) y ON y.MKB_SPK_NOMOR = x.Spk
    ORDER BY x.NoMinta, x.promind_bhn_kode
  `;
  const [rows] = await db.query(sql, [spk]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua SPK sesuai filter master
// ─────────────────────────────────────────────
const getAllDetail = async (
  startDate,
  endDate,
  spk = "",
  isMap = false,
  canLihatCus = false,
  namaBahan = "",
) => {
  const master = await getBrowse(
    startDate,
    endDate,
    spk,
    isMap,
    canLihatCus,
    namaBahan,
  );
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Spk, canLihatCus);
    for (const d of dtl) {
      result.push({
        Divisi: m.Divisi,
        Nama: m.Nama,
        Customer: m.Customer,
        ...d,
      });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
