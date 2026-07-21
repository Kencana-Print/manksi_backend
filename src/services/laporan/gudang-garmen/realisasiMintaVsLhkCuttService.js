const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — satu baris per (Nomor Minta + Kode Bahan), TANPA GROUP BY
// (beda dari menu 515 yang rekap SUM per Nomor). Persis replikasi
// ufrmLapMintavsProduksi.pas — Lhk/Cmt di-filter per bahan (bhn_kode),
// bukan per Nomor Minta saja.
// GudangTujuan: RIGHT(gdgp_nama, LEN-6) — quirk offset -6, beda dari
// menu 515 yang pakai -3. Jangan disamakan, ini file Delphi berbeda.
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
    SELECT x.*,
      (x.JmlLhk + x.JmlCmt) AS TotalPotong,
      ((x.JmlMinta - x.JmlRetur) - (x.JmlLhk + x.JmlCmt)) AS Sisa,
      IF(ROUND(x.JmlLhk + x.JmlCmt, 2) < ROUND(x.JmlMinta - x.JmlRetur, 2), 'OPEN', 'CLOSE') AS Status
    FROM (
      SELECT
        CONCAT(h.promin_nomor, ' ', d.promind_bhn_kode) AS Id,
        h.promin_nomor AS Nomor,
        DATE_FORMAT(h.promin_tanggal, '%Y-%m-%d') AS Tanggal,
        h.promin_spk_nomor AS Spk,
        IFNULL(s.spk_nama, m.mspk_nama) AS NamaSpk,
        IFNULL(s.spk_jumlah, m.mspk_jumlah) AS JmlSpk,
        RIGHT(p.gdgp_nama, LENGTH(p.gdgp_nama) - 6) AS Tujuan,
        d.promind_bhn_kode AS Kode,
        b.Bhn_Name AS NamaBahan,
        b.bhn_satuan AS Satuan,
        d.promind_Jumlah AS JmlMinta,
        IFNULL((
          SELECT SUM(r.proretd_Jumlah) FROM tproduksiretur_dtl r
          WHERE r.proretd_nominta = h.promin_nomor
            AND r.proretd_bhn_kode = d.promind_bhn_kode
        ), 0) AS JmlRetur,
        IFNULL((
          SELECT SUM(mm.mph_qty_berat) FROM tmutasiproduksi_hdr mm
          WHERE mm.mph_nomaterial = h.promin_nomor
            AND mm.mph_bhn_kode = b.Bhn_kode
        ), 0) AS JmlLhk,
        IFNULL((
          SELECT SUM(j.bpj_qty_berat) FROM tbpj_hdr j
          WHERE j.bpj_nomaterial = h.promin_nomor
            AND j.bpj_bhn_kode = b.Bhn_kode
        ), 0) AS JmlCmt
      FROM tproduksiminta_hdr h
      LEFT JOIN tproduksiminta_dtl d ON d.promind_promin_Nomor = h.promin_nomor
      LEFT JOIN tspk s ON s.spk_nomor = h.promin_spk_nomor
      LEFT JOIN tmemospk m ON m.mspk_nomor = h.promin_spk_nomor
      LEFT JOIN tgudangproduksi p ON p.gdgp_kode = h.promin_gdgp_kode
      LEFT JOIN tbahan b ON b.Bhn_kode = d.promind_bhn_kode
      ${where}
    ) x
    ORDER BY x.Id
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — transaksi Mutasi Produksi (LHK) + BPJ Jasa (CMT) untuk
// satu kombinasi (Nomor Minta, Kode Bahan). Delphi mengandalkan
// MasterKeyField='Id' utk filter otomatis; di web difilter eksplisit
// by nomaterial+bhn_kode (bukan tanggal), sama seperti pola getDetail
// di realisasiMintaBahanService.js.
// ─────────────────────────────────────────────
const getDetail = async (spk) => {
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
      x.Sup_nama AS Supplier,
      y.Mkb AS NoMkb,
      DATE_FORMAT(y.TglMkb, '%Y-%m-%d') AS TglMkb,
      y.Komponen AS Komponen,
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
      SELECT m.mph_nomor AS nomor, m.mph_tanggal AS tgl, m.mph_jumlah AS jml,
        m.mph_qty_berat AS berat, m.mph_sat_berat AS sat,
        m.mph_bhn_kode AS kode, m.mph_nomaterial AS mat
      FROM tmutasiproduksi_hdr m WHERE m.mph_nomaterial <> ''
      UNION ALL
      SELECT j.bpj_Nomor AS nomor, j.bpj_tanggal AS tgl, j.bpj_jumlah AS jml,
        j.bpj_qty_berat AS berat, j.bpj_sat_berat AS sat,
        j.bpj_bhn_kode AS kode, j.bpj_nomaterial AS mat
      FROM tbpj_hdr j WHERE j.bpj_nomaterial <> ''
    ) m ON m.mat = x.NoMinta AND m.kode = x.promind_bhn_kode
    LEFT JOIN (
      -- ⚠️ REPLIKASI PERSIS BUG DELPHI: subquery MKB di-GROUP BY per SPK
      -- saja, tapi mkbd_bhn_kode & mkbd_komponen di-SELECT tanpa masuk
      -- GROUP BY (quirk non-standard SQL) — engine "memenangkan" 1 baris
      -- arbitrary. Delphi replikasi persis pakai mkbd_bhn_kode arbitrary
      -- itu sebagai syarat join kedua (y.mkbd_bhn_kode=a.KodeBahan), jadi
      -- MKB CUMA nempel ke SATU baris bahan "pemenang" per SPK — baris
      -- bahan lain di SPK yang sama tetap NULL walau MKB itu milik SPK
      -- tsb. Kita bikin deterministik: "pemenang" = baris tmkb_dtl dengan
      -- mkbd_nourut terkecil per SPK (bukan random optimizer pick).
      SELECT
        j.MKB_SPK_NOMOR,
        MIN(j.MKB_NOMOR) AS Mkb,
        MIN(j.MKB_TANGGAL) AS TglMkb,
        SUM(i.mkbd_jumlah) AS QtyMkb,
        SUM(i.mkbd_babaran) AS BabaranMkb,
        (
          SELECT i2.mkbd_komponen
          FROM tmkb_dtl i2
          INNER JOIN tmkb_hdr j2 ON j2.MKB_NOMOR = i2.mkbd_mkb_nomor
          WHERE j2.MKB_SPK_NOMOR = j.MKB_SPK_NOMOR
          ORDER BY i2.mkbd_nourut ASC
          LIMIT 1
        ) AS Komponen,
        (
          SELECT i3.mkbd_bhn_kode
          FROM tmkb_dtl i3
          INNER JOIN tmkb_hdr j3 ON j3.MKB_NOMOR = i3.mkbd_mkb_nomor
          WHERE j3.MKB_SPK_NOMOR = j.MKB_SPK_NOMOR
          ORDER BY i3.mkbd_nourut ASC
          LIMIT 1
        ) AS WinningBhnKode
      FROM tmkb_hdr j
      INNER JOIN tmkb_dtl i ON i.mkbd_mkb_nomor = j.MKB_NOMOR
      GROUP BY j.MKB_SPK_NOMOR
    ) y ON y.MKB_SPK_NOMOR = x.Spk AND y.WinningBhnKode = x.promind_bhn_kode
    ORDER BY x.NoMinta, x.promind_bhn_kode
  `;
  const [rows] = await db.query(sql, [spk]);
  return rows;
};

// ─────────────────────────────────────────────
// ALL DETAIL — gabungan detail semua baris master sesuai filter
// (tombol Export Detail)
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, cab = "ALL", spk = "") => {
  const master = await getBrowse(startDate, endDate, cab, spk);
  const result = [];
  for (const m of master) {
    const dtl = await getDetail(m.Nomor, m.Kode);
    for (const d of dtl) {
      result.push({
        Nomor: m.Nomor,
        Spk: m.Spk,
        NamaSpk: m.NamaSpk,
        Tujuan: m.Tujuan,
        Kode: m.Kode,
        NamaBahan: m.NamaBahan,
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
