// services/sjHasilMaklon.service.js
const MKL_DB = "kencanaprint";
const pool = require("../../../../config/database");

const normalizeCabang = (cab) => {
  const val = String(cab ?? "")
    .replace(/-/g, "")
    .trim()
    .toUpperCase();
  if (!val || val === "ALL" || val === "ADMIN" || val.startsWith("HO")) {
    return null;
  }
  return val;
};

// Hitung ulang status Maklon dari kondisi data aktual
const recomputeStatus = async (conn, mklNomor) => {
  const [dtlRows] = await conn.query(
    `SELECT mkld_qty_kirim, mkld_qty_sudah_kirim, mkld_qty_terima, mkld_qty_bs
     FROM ${MKL_DB}.tmaklon_dtl WHERE mkld_mkl_nomor = ?`,
    [mklNomor],
  );
  if (!dtlRows.length) return;

  const totalRows = dtlRows.length;
  const sentFullCount = dtlRows.filter(
    (r) => Number(r.mkld_qty_sudah_kirim) >= Number(r.mkld_qty_kirim),
  ).length;
  const sentAnyCount = dtlRows.filter(
    (r) => Number(r.mkld_qty_sudah_kirim) > 0,
  ).length;
  const receivedFullCount = dtlRows.filter(
    (r) =>
      Number(r.mkld_qty_terima) + Number(r.mkld_qty_bs) >=
      Number(r.mkld_qty_kirim),
  ).length;
  const receivedAnyCount = dtlRows.filter(
    (r) => Number(r.mkld_qty_terima) + Number(r.mkld_qty_bs) > 0,
  ).length;

  // DTF maklon hasil
  const [[dtfRow]] = await conn.query(
    `SELECT COUNT(DISTINCT dm.kode_polos) AS cnt
     FROM ${MKL_DB}.tdtf_maklon dm
     INNER JOIN ${MKL_DB}.tdtf_maklon_hasil dh ON dh.dmh_dtf_maklon_id = dm.id
     WHERE dm.mkl_nomor = ?
       AND dh.dmh_kode_hasil IS NOT NULL AND dh.dmh_kode_hasil <> ''`,
    [mklNomor],
  );
  const dtfDoneCount = Number(dtfRow.cnt);

  // P05 Mesin Cetak hasil
  const [[mesinRow]] = await conn.query(
    `SELECT COUNT(*) AS cnt
     FROM ${MKL_DB}.tlhk_mesin_dtl
     WHERE TRIM(ld_spk_nomor) = ? AND ld_total_qtycetak > 0`,
    [mklNomor],
  );
  const mesinDoneCount = Number(mesinRow?.cnt || 0);

  const [[sjRow]] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM ${MKL_DB}.tsj_maklon_hdr WHERE sjm_mkl_nomor = ?`,
    [mklNomor],
  );
  const sjExists = Number(sjRow.cnt) > 0;

  let status;
  if (receivedFullCount === totalRows) status = "SELESAI";
  else if (receivedAnyCount > 0) status = "DITERIMA SEBAGIAN";
  else if (sjExists) status = "OTW GUDANG";
  else if (dtfDoneCount >= totalRows || mesinDoneCount > 0) status = "SELESAI DTF";
  else if (sentFullCount === totalRows) status = "DIKIRIM";
  else if (sentAnyCount > 0) status = "SEBAGIAN DIKIRIM";
  else status = "DRAFT";

  await conn.query(
    `UPDATE ${MKL_DB}.tmaklon_hdr SET
       mkl_status = ?,
       mkl_tgl_kirim = IF(mkl_tgl_kirim IS NULL AND ? >= 1, NOW(), mkl_tgl_kirim),
       mkl_tgl_selesai_dtf = IF(mkl_tgl_selesai_dtf IS NULL AND (? >= ? OR ? > 0), NOW(), mkl_tgl_selesai_dtf),
       mkl_tgl_otw_gudang = IF(mkl_tgl_otw_gudang IS NULL AND ?, NOW(), mkl_tgl_otw_gudang),
       mkl_tgl_selesai = IF(mkl_tgl_selesai IS NULL AND ? = ?, NOW(), mkl_tgl_selesai)
     WHERE mkl_nomor = ?`,
    [
      status,
      sentFullCount,
      dtfDoneCount,
      totalRows,
      mesinDoneCount,
      sjExists ? 1 : 0,
      receivedFullCount,
      totalRows,
      mklNomor,
    ],
  );
};

// ─────────────────────────────────────────────────────────
// OUTSTANDING — baris LHK Maklon yang belum pernah dibuatkan SJ Hasil Maklon
// Mendukung DTF (tdtf_maklon_hasil) & P05 Cetak MMT (tlhk_mesin_hdr & dtl)
// ─────────────────────────────────────────────────────────
const getOutstanding = async ({ startDate, endDate, cab, semuaCabang, keyword }) => {
  const start = startDate && String(startDate).trim() !== "" ? String(startDate).trim() : "2000-01-01";
  const end = endDate && String(endDate).trim() !== "" ? String(endDate).trim() : "2099-12-31";

  const isAll = semuaCabang === true || semuaCabang === "true" || semuaCabang === "1" || cab === "ALL";
  const cabang = !isAll ? normalizeCabang(cab) : null;

  // 1. QUERY DTF (P01 / Garmen)
  const dtfParams = [start, end];
  let dtfCabFilter = "";
  if (cabang) {
    dtfCabFilter = ` AND (REPLACE(dm.cab, '-', '') = ? OR REPLACE(h.mkl_cab_tujuan, '-', '') = ? OR REPLACE(h.mkl_cab_asal, '-', '') = ?)`;
    dtfParams.push(cabang, cabang, cabang);
  }

  let dtfKwFilter = "";
  if (keyword && String(keyword).trim() !== "") {
    dtfKwFilter = ` AND (dm.mkl_nomor LIKE ? OR dm.kode_polos LIKE ? OR bp.brg_nama LIKE ? OR dh.dmh_kode_hasil LIKE ? OR bh.brg_nama LIKE ?)`;
    const kw = `%${String(keyword).trim()}%`;
    dtfParams.push(kw, kw, kw, kw, kw);
  }

  const sqlDtf = `
    SELECT
      CAST(dh.id AS CHAR) AS DtfMaklonHasilId,
      CAST(dm.id AS CHAR) AS DtfMaklonId,
      dm.mkl_nomor AS MklNomor,
      dm.tanggal AS Tanggal,
      dm.cab AS Cab,
      h.mkl_cab_asal AS CabAsal,
      ga.pab_nama AS NamaCabAsal,
      h.mkl_cab_tujuan AS CabTujuan,
      gt.pab_nama AS NamaCabTujuan,
      dm.kode_polos AS KodePolos,
      COALESCE(bp.brg_nama, dm.kode_polos) AS NamaPolos,
      dh.dmh_kode_hasil AS KodeHasil,
      COALESCE(bh.brg_nama, dh.dmh_kode_hasil) AS NamaHasil,
      COALESCE(dm.satuan, 'PCS') AS Satuan,
      dm.qty_masuk AS QtyMasuk,
      dh.dmh_qty_hasil AS QtyHasil,
      dh.dmh_bs_afval AS BsAfval,
      dm.keterangan AS Keterangan,
      dm.lhk_nomor AS LhkNomor,
      0 AS LhkUrut,
      kd.mkld_id AS MkldId,
      'DTF' AS Sumber
    FROM ${MKL_DB}.tdtf_maklon_hasil dh
    JOIN ${MKL_DB}.tdtf_maklon dm ON dm.id = dh.dmh_dtf_maklon_id
    JOIN ${MKL_DB}.tmaklon_hdr h ON h.mkl_nomor = dm.mkl_nomor
    LEFT JOIN ${MKL_DB}.tmaklon_dtl kd ON kd.mkld_mkl_nomor = dm.mkl_nomor AND kd.mkld_kode_polos = dm.kode_polos
    LEFT JOIN ${MKL_DB}.tgarmen_brg bp ON bp.brg_kode = dm.kode_polos
    LEFT JOIN ${MKL_DB}.tgarmen_brg bh ON bh.brg_kode = dh.dmh_kode_hasil
    LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    WHERE dm.tanggal BETWEEN ? AND ?
      ${dtfCabFilter}
      ${dtfKwFilter}
      AND NOT EXISTS (
        SELECT 1 FROM ${MKL_DB}.tsj_maklon_dtl sd WHERE sd.sjmd_dtf_maklon_hasil_id = dh.id
      )
  `;

  // 2. QUERY P05 (MMT / Mesin Cetak tlhk_mesin_hdr & dtl)
  const p05Params = [start, end];
  let p05CabFilter = "";
  if (cabang) {
    p05CabFilter = ` AND (REPLACE(h.mkl_cab_tujuan, '-', '') = ? OR REPLACE(h.mkl_cab_asal, '-', '') = ?)`;
    p05Params.push(cabang, cabang);
  }

  let p05KwFilter = "";
  if (keyword && String(keyword).trim() !== "") {
    p05KwFilter = ` AND (h.mkl_nomor LIKE ? OR md.ld_lnomor LIKE ? OR kd.mkld_kode_polos LIKE ? OR kj.mkldj_kode_jadi LIKE ? OR bh.brg_nama LIKE ?)`;
    const kw = `%${String(keyword).trim()}%`;
    p05Params.push(kw, kw, kw, kw, kw);
  }

  const sqlP05 = `
    SELECT
      CONCAT('P05_', md.ld_lnomor, '_', md.ld_urut) AS DtfMaklonHasilId,
      CONCAT('P05_', md.ld_lnomor) AS DtfMaklonId,
      TRIM(md.ld_spk_nomor) AS MklNomor,
      mh.ltanggal AS Tanggal,
      'P05' AS Cab,
      h.mkl_cab_asal AS CabAsal,
      ga.pab_nama AS NamaCabAsal,
      h.mkl_cab_tujuan AS CabTujuan,
      gt.pab_nama AS NamaCabTujuan,
      COALESCE(kd.mkld_kode_polos, mh.lbahan) AS KodePolos,
      COALESCE(kd.mkld_nama_polos_manual, bp.brg_nama, kd.mkld_kode_polos, mh.lbahan) AS NamaPolos,
      COALESCE(kj.mkldj_kode_jadi, h.mkl_keterangan) AS KodeHasil,
      COALESCE(bh.brg_nama, kj.mkldj_kode_jadi, h.mkl_keterangan) AS NamaHasil,
      COALESCE(NULLIF(kd.mkld_satuan_kirim, ''), 'PCS') AS Satuan,
      COALESCE(kd.mkld_qty_kirim, 0) AS QtyMasuk,
      md.ld_total_qtycetak AS QtyHasil,
      COALESCE(md.ld_bsmeter, 0) AS BsAfval,
      COALESCE(NULLIF(TRIM(md.ld_keterangan), "''"), h.mkl_keterangan, '') AS Keterangan,
      md.ld_lnomor AS LhkNomor,
      CAST(md.ld_urut AS SIGNED) AS LhkUrut,
      kd.mkld_id AS MkldId,
      'P05' AS Sumber
    FROM ${MKL_DB}.tlhk_mesin_dtl md
    JOIN ${MKL_DB}.tlhk_mesin_hdr mh ON mh.lnomor = md.ld_lnomor
    JOIN ${MKL_DB}.tmaklon_hdr h ON h.mkl_nomor = TRIM(md.ld_spk_nomor)
    LEFT JOIN ${MKL_DB}.tmaklon_dtl kd ON kd.mkld_mkl_nomor = h.mkl_nomor
    LEFT JOIN ${MKL_DB}.tmaklon_dtl_jadi kj ON kj.mkldj_mkld_id = kd.mkld_id
    LEFT JOIN ${MKL_DB}.tgarmen_brg bp ON bp.brg_kode = kd.mkld_kode_polos
    LEFT JOIN ${MKL_DB}.tgarmen_brg bh ON bh.brg_kode = kj.mkldj_kode_jadi
    LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    WHERE mh.ltanggal BETWEEN ? AND ?
      ${p05CabFilter}
      ${p05KwFilter}
      AND NOT EXISTS (
        SELECT 1 FROM ${MKL_DB}.tsj_maklon_dtl sd WHERE sd.sjmd_lhk_nomor = md.ld_lnomor
      )
  `;

  const [rowsDtf] = await pool.query(sqlDtf, dtfParams);
  const [rowsP05] = await pool.query(sqlP05, p05Params);

  const combined = [...rowsDtf, ...rowsP05];
  combined.sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
  return combined;
};

// ─────────────────────────────────────────────────────────
// AVAILABLE MAKLON — daftar Maklon yang memiliki LHK belum dibuatkan SJ
// Untuk autocomplete / lookup pembuat SJ Hasil Maklon langsung
// ─────────────────────────────────────────────────────────
const getAvailableMaklon = async ({ cab, semuaCabang } = {}) => {
  const isAll = semuaCabang === true || semuaCabang === "true" || semuaCabang === "1" || cab === "ALL";
  const cabang = !isAll ? normalizeCabang(cab) : null;

  let p05CabFilter = "";
  const p05Params = [];
  if (cabang) {
    p05CabFilter = ` AND (REPLACE(h.mkl_cab_tujuan, '-', '') = ? OR REPLACE(h.mkl_cab_asal, '-', '') = ?)`;
    p05Params.push(cabang, cabang);
  }

  const [p05] = await pool.query(`
    SELECT
      TRIM(md.ld_spk_nomor) AS MklNomor,
      h.mkl_tanggal AS Tanggal,
      h.mkl_cab_asal AS CabAsal,
      ga.pab_nama AS NamaCabAsal,
      h.mkl_cab_tujuan AS CabTujuan,
      gt.pab_nama AS NamaCabTujuan,
      h.mkl_keterangan AS Keterangan,
      SUM(md.ld_total_qtycetak) AS TotalQtyHasil,
      COUNT(DISTINCT md.ld_lnomor) AS JmlLhk,
      'P05' AS Sumber
    FROM ${MKL_DB}.tlhk_mesin_dtl md
    JOIN ${MKL_DB}.tlhk_mesin_hdr mh ON mh.lnomor = md.ld_lnomor
    JOIN ${MKL_DB}.tmaklon_hdr h ON h.mkl_nomor = TRIM(md.ld_spk_nomor)
    LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    WHERE NOT EXISTS (
      SELECT 1 FROM ${MKL_DB}.tsj_maklon_dtl sd WHERE sd.sjmd_lhk_nomor = md.ld_lnomor
    )
    ${p05CabFilter}
    GROUP BY TRIM(md.ld_spk_nomor), h.mkl_tanggal, h.mkl_cab_asal, ga.pab_nama, h.mkl_cab_tujuan, gt.pab_nama, h.mkl_keterangan
  `, p05Params);

  let dtfCabFilter = "";
  const dtfParams = [];
  if (cabang) {
    dtfCabFilter = ` AND (REPLACE(dm.cab, '-', '') = ? OR REPLACE(h.mkl_cab_tujuan, '-', '') = ? OR REPLACE(h.mkl_cab_asal, '-', '') = ?)`;
    dtfParams.push(cabang, cabang, cabang);
  }

  const [dtf] = await pool.query(`
    SELECT
      dm.mkl_nomor AS MklNomor,
      h.mkl_tanggal AS Tanggal,
      h.mkl_cab_asal AS CabAsal,
      ga.pab_nama AS NamaCabAsal,
      h.mkl_cab_tujuan AS CabTujuan,
      gt.pab_nama AS NamaCabTujuan,
      h.mkl_keterangan AS Keterangan,
      SUM(dh.dmh_qty_hasil) AS TotalQtyHasil,
      COUNT(DISTINCT dm.lhk_nomor) AS JmlLhk,
      'DTF' AS Sumber
    FROM ${MKL_DB}.tdtf_maklon_hasil dh
    JOIN ${MKL_DB}.tdtf_maklon dm ON dm.id = dh.dmh_dtf_maklon_id
    JOIN ${MKL_DB}.tmaklon_hdr h ON h.mkl_nomor = dm.mkl_nomor
    LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    WHERE NOT EXISTS (
      SELECT 1 FROM ${MKL_DB}.tsj_maklon_dtl sd WHERE sd.sjmd_dtf_maklon_hasil_id = dh.id
    )
    ${dtfCabFilter}
    GROUP BY dm.mkl_nomor, h.mkl_tanggal, h.mkl_cab_asal, ga.pab_nama, h.mkl_cab_tujuan, gt.pab_nama, h.mkl_keterangan
  `, dtfParams);

  const combined = [...p05, ...dtf];
  combined.sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
  return combined;
};

// ─────────────────────────────────────────────────────────
// HISTORY — daftar SJ Hasil Maklon yang sudah dibuat.
// ─────────────────────────────────────────────────────────
const getHistory = async ({ startDate, endDate, cab, semuaCabang, keyword }) => {
  const start = startDate && String(startDate).trim() !== "" ? String(startDate).trim() : "2000-01-01";
  const end = endDate && String(endDate).trim() !== "" ? String(endDate).trim() : "2099-12-31";

  const params = [start, end];
  let cabFilter = "";
  const isAll = semuaCabang === true || semuaCabang === "true" || semuaCabang === "1" || cab === "ALL";
  const cabang = !isAll ? normalizeCabang(cab) : null;
  if (cabang) {
    cabFilter = ` AND (REPLACE(h.sjm_cab_penerima, '-', '') = ? OR REPLACE(m.mkl_cab_asal, '-', '') = ? OR REPLACE(m.mkl_cab_tujuan, '-', '') = ?)`;
    params.push(cabang, cabang, cabang);
  }

  let kwFilter = "";
  if (keyword && String(keyword).trim() !== "") {
    kwFilter = ` AND (h.sjm_nomor LIKE ? OR h.sjm_mkl_nomor LIKE ? OR gp.pab_nama LIKE ?)`;
    const kw = `%${String(keyword).trim()}%`;
    params.push(kw, kw, kw);
  }

  const [rows] = await pool.query(
    `SELECT
       h.sjm_nomor AS Nomor,
       h.sjm_mkl_nomor AS MklNomor,
       h.sjm_tanggal AS Tanggal,
       h.sjm_cab_penerima AS CabPenerima,
       gp.pab_nama AS NamaCabPenerima,
       m.mkl_cab_asal AS CabAsal,
       ga.pab_nama AS NamaCabAsal,
       m.mkl_cab_tujuan AS CabTujuan,
       gt.pab_nama AS NamaCabTujuan,
       h.sjm_user_create AS UserCreate,
       COUNT(d.sjmd_id) AS JmlItem,
       SUM(d.sjmd_qty_terima) AS TotalTerima,
       SUM(d.sjmd_qty_bs) AS TotalBs
     FROM ${MKL_DB}.tsj_maklon_hdr h
     LEFT JOIN ${MKL_DB}.tsj_maklon_dtl d ON d.sjmd_sjm_nomor = h.sjm_nomor
     LEFT JOIN ${MKL_DB}.tmaklon_hdr m ON m.mkl_nomor = h.sjm_mkl_nomor
     LEFT JOIN ${MKL_DB}.tpabrik gp ON gp.pab_kode = h.sjm_cab_penerima
     LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = m.mkl_cab_asal
     LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = m.mkl_cab_tujuan
     WHERE h.sjm_tanggal BETWEEN ? AND ?
       ${cabFilter}
       ${kwFilter}
     GROUP BY h.sjm_nomor
     ORDER BY h.sjm_tanggal DESC, h.sjm_nomor DESC`,
    params,
  );
  return rows;
};

const getHistoryDetail = async (sjmNomor) => {
  const [rows] = await pool.query(
    `SELECT d.sjmd_kode_jadi AS KodeJadi,
            COALESCE(b.brg_nama, d.sjmd_kode_jadi) AS NamaJadi,
            COALESCE(b.brg_satuan, 'PCS') AS Satuan,
            d.sjmd_qty_terima AS QtyTerima,
            d.sjmd_qty_bs AS QtyBs,
            COALESCE(NULLIF(d.sjmd_lhk_nomor, ''), dm.lhk_nomor, '-') AS LhkNomor
     FROM ${MKL_DB}.tsj_maklon_dtl d
     LEFT JOIN ${MKL_DB}.tgarmen_brg b ON b.brg_kode = d.sjmd_kode_jadi
     LEFT JOIN ${MKL_DB}.tdtf_maklon dm ON dm.id = d.sjmd_dtf_maklon_id
     WHERE d.sjmd_sjm_nomor = ?
     ORDER BY d.sjmd_id`,
    [sjmNomor],
  );
  return rows;
};

const generateNomor = async (conn) => {
  const year = new Date().getFullYear();
  const [[last]] = await conn.query(
    `SELECT sjm_nomor FROM ${MKL_DB}.tsj_maklon_hdr WHERE sjm_nomor LIKE ? ORDER BY sjm_nomor DESC LIMIT 1 FOR UPDATE`,
    [`SJHM.${year}.%`],
  );
  const nextUrut = last ? parseInt(last.sjm_nomor.split(".")[2], 10) + 1 : 1;
  return `SJHM.${year}.${String(nextUrut).padStart(5, "0")}`;
};

// Data untuk form Create dari daftar id atau nomor maklon
const getCreateData = async ({ ids = [], mklNomor = null }) => {
  const hasIds = Array.isArray(ids) && ids.length > 0;
  if (!hasIds && !mklNomor) throw new Error("Tidak ada baris atau Nomor Maklon yang dipilih.");

  let items = [];

  // 1. P05 tlhk_mesin
  let p05Where = `
    NOT EXISTS (
      SELECT 1 FROM ${MKL_DB}.tsj_maklon_dtl sd WHERE sd.sjmd_lhk_nomor = md.ld_lnomor
    )
  `;
  const p05Params = [];
  if (hasIds) {
    p05Where += ` AND (
      CONCAT('P05_', md.ld_lnomor, '_', md.ld_urut) IN (?)
      OR CONCAT('P05_', md.ld_lnomor) IN (?)
      OR md.ld_lnomor IN (?)
    )`;
    p05Params.push(ids, ids, ids);
  }
  if (mklNomor) {
    p05Where += ` AND TRIM(md.ld_spk_nomor) = ?`;
    p05Params.push(mklNomor.trim());
  }

  const [p05Rows] = await pool.query(`
    SELECT
      CONCAT('P05_', md.ld_lnomor, '_', md.ld_urut) AS DtfMaklonHasilId,
      CONCAT('P05_', md.ld_lnomor) AS DtfMaklonId,
      TRIM(md.ld_spk_nomor) AS MklNomor,
      mh.ltanggal AS Tanggal,
      'P05' AS Cab,
      h.mkl_cab_asal AS CabAsal,
      ga.pab_nama AS NamaCabAsal,
      h.mkl_cab_tujuan AS CabTujuan,
      gt.pab_nama AS NamaCabTujuan,
      COALESCE(kd.mkld_kode_polos, mh.lbahan) AS KodePolos,
      COALESCE(kd.mkld_nama_polos_manual, bp.brg_nama, kd.mkld_kode_polos, mh.lbahan) AS NamaPolos,
      COALESCE(kj.mkldj_kode_jadi, h.mkl_keterangan) AS KodeHasil,
      COALESCE(bh.brg_nama, kj.mkldj_kode_jadi, h.mkl_keterangan) AS NamaHasil,
      COALESCE(NULLIF(kd.mkld_satuan_kirim, ''), 'PCS') AS Satuan,
      COALESCE(kd.mkld_qty_kirim, 0) AS QtyMasuk,
      md.ld_total_qtycetak AS QtyHasil,
      COALESCE(md.ld_bsmeter, 0) AS BsAfval,
      COALESCE(NULLIF(TRIM(md.ld_keterangan), "''"), h.mkl_keterangan, '') AS Keterangan,
      md.ld_lnomor AS LhkNomor,
      CAST(md.ld_urut AS SIGNED) AS LhkUrut,
      kd.mkld_id AS MkldId,
      'P05' AS Sumber
    FROM ${MKL_DB}.tlhk_mesin_dtl md
    JOIN ${MKL_DB}.tlhk_mesin_hdr mh ON mh.lnomor = md.ld_lnomor
    JOIN ${MKL_DB}.tmaklon_hdr h ON h.mkl_nomor = TRIM(md.ld_spk_nomor)
    LEFT JOIN ${MKL_DB}.tmaklon_dtl kd ON kd.mkld_mkl_nomor = h.mkl_nomor
    LEFT JOIN ${MKL_DB}.tmaklon_dtl_jadi kj ON kj.mkldj_mkld_id = kd.mkld_id
    LEFT JOIN ${MKL_DB}.tgarmen_brg bp ON bp.brg_kode = kd.mkld_kode_polos
    LEFT JOIN ${MKL_DB}.tgarmen_brg bh ON bh.brg_kode = kj.mkldj_kode_jadi
    LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    WHERE ${p05Where}
  `, p05Params);

  items.push(...p05Rows);

  // 2. DTF
  let dtfWhere = `
    NOT EXISTS (
      SELECT 1 FROM ${MKL_DB}.tsj_maklon_dtl sd WHERE sd.sjmd_dtf_maklon_hasil_id = dh.id
    )
  `;
  const dtfParams = [];
  if (hasIds) {
    const numericIds = ids.map(Number).filter((n) => !isNaN(n) && n > 0);
    if (numericIds.length > 0) {
      dtfWhere += ` AND (dh.id IN (?) OR dm.id IN (?))`;
      dtfParams.push(numericIds, numericIds);
    } else {
      dtfWhere += ` AND 1=0`;
    }
  }
  if (mklNomor) {
    dtfWhere += ` AND dm.mkl_nomor = ?`;
    dtfParams.push(mklNomor.trim());
  }

  const [dtfRows] = await pool.query(`
    SELECT
      CAST(dh.id AS CHAR) AS DtfMaklonHasilId,
      CAST(dm.id AS CHAR) AS DtfMaklonId,
      dm.mkl_nomor AS MklNomor,
      dm.tanggal AS Tanggal,
      dm.cab AS Cab,
      h.mkl_cab_asal AS CabAsal,
      ga.pab_nama AS NamaCabAsal,
      h.mkl_cab_tujuan AS CabTujuan,
      gt.pab_nama AS NamaCabTujuan,
      dm.kode_polos AS KodePolos,
      COALESCE(bp.brg_nama, dm.kode_polos) AS NamaPolos,
      dh.dmh_kode_hasil AS KodeHasil,
      COALESCE(bh.brg_nama, dh.dmh_kode_hasil) AS NamaHasil,
      COALESCE(dm.satuan, 'PCS') AS Satuan,
      dm.qty_masuk AS QtyMasuk,
      dh.dmh_qty_hasil AS QtyHasil,
      dh.dmh_bs_afval AS BsAfval,
      dm.keterangan AS Keterangan,
      dm.lhk_nomor AS LhkNomor,
      0 AS LhkUrut,
      kd.mkld_id AS MkldId,
      'DTF' AS Sumber
    FROM ${MKL_DB}.tdtf_maklon_hasil dh
    JOIN ${MKL_DB}.tdtf_maklon dm ON dm.id = dh.dmh_dtf_maklon_id
    JOIN ${MKL_DB}.tmaklon_hdr h ON h.mkl_nomor = dm.mkl_nomor
    LEFT JOIN ${MKL_DB}.tmaklon_dtl kd ON kd.mkld_mkl_nomor = dm.mkl_nomor AND kd.mkld_kode_polos = dm.kode_polos
    LEFT JOIN ${MKL_DB}.tgarmen_brg bp ON bp.brg_kode = dm.kode_polos
    LEFT JOIN ${MKL_DB}.tgarmen_brg bh ON bh.brg_kode = dh.dmh_kode_hasil
    LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
    LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
    WHERE ${dtfWhere}
  `, dtfParams);

  items.push(...dtfRows);

  if (!items.length) {
    throw new Error("Baris tidak ditemukan atau sudah dibuatkan SJ Hasil Maklon.");
  }

  const mklNomorSet = new Set(items.map((r) => r.MklNomor));
  if (mklNomorSet.size > 1) {
    throw new Error("Semua baris harus berasal dari No. Maklon yang sama.");
  }

  const resolvedMklNomor = mklNomor || items[0].MklNomor;
  const [[hdr]] = await pool.query(
    `SELECT h.mkl_nomor, h.mkl_cab_asal, h.mkl_cab_tujuan,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM ${MKL_DB}.tmaklon_hdr h
     LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = h.mkl_cab_asal
     LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = h.mkl_cab_tujuan
     WHERE h.mkl_nomor = ?`,
    [resolvedMklNomor],
  );

  return { header: hdr, items };
};

const createSjHasilMaklon = async (payload, user) => {
  const { tanggal, ids, mklNomor: payloadMklNomor, items: payloadItems } = payload;
  if (!tanggal) throw new Error("Tanggal wajib diisi.");

  let mklNomor = payloadMklNomor ? String(payloadMklNomor).trim() : null;

  if (!mklNomor && ids && ids.length) {
    const firstId = ids[0];
    if (String(firstId).startsWith("P05_")) {
      const parts = String(firstId).split("_");
      const lhkNomor = parts[1];
      const [[first]] = await pool.query(
        `SELECT TRIM(ld_spk_nomor) AS mkl_nomor FROM ${MKL_DB}.tlhk_mesin_dtl WHERE ld_lnomor = ? LIMIT 1`,
        [lhkNomor],
      );
      if (first) mklNomor = first.mkl_nomor;
    } else {
      const [[first]] = await pool.query(
        `SELECT dm.mkl_nomor
         FROM ${MKL_DB}.tdtf_maklon_hasil dh
         JOIN ${MKL_DB}.tdtf_maklon dm ON dm.id = dh.dmh_dtf_maklon_id
         WHERE (dh.id = ? OR dm.id = ?) LIMIT 1`,
        [firstId, firstId],
      );
      if (first) mklNomor = first.mkl_nomor;
    }
  }

  if (!mklNomor) throw new Error("Nomor Maklon tidak ditemukan.");

  const [[mklHdr]] = await pool.query(
    `SELECT mkl_nomor, mkl_cab_asal FROM ${MKL_DB}.tmaklon_hdr WHERE mkl_nomor = ?`,
    [mklNomor],
  );
  if (!mklHdr) throw new Error(`Data Maklon induk ${mklNomor} tidak ditemukan.`);
  const cabPenerima = mklHdr.mkl_cab_asal;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const nomor = await generateNomor(conn);

    await conn.query(
      `INSERT INTO ${MKL_DB}.tsj_maklon_hdr (sjm_nomor, sjm_mkl_nomor, sjm_tanggal, sjm_cab_penerima, sjm_user_create, sjm_date_create)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [nomor, mklNomor, tanggal, cabPenerima, user?.kode || user?.kdUser || "SYSTEM"],
    );

    if (payloadItems && payloadItems.length > 0) {
      for (const it of payloadItems) {
        let mkldId = it.mkld_id;
        if (!mkldId) {
          const [[mkld]] = await conn.query(
            `SELECT mkld_id FROM ${MKL_DB}.tmaklon_dtl WHERE mkld_mkl_nomor = ? LIMIT 1`,
            [mklNomor],
          );
          mkldId = mkld?.mkld_id || null;
        }

        // Pastikan sjmd_dtf_maklon_id merujuk ke id yang valid di tdtf_maklon
        // agar constraint fk_sjmd_dtf_maklon FOREIGN KEY (sjmd_dtf_maklon_id) REFERENCES tdtf_maklon (id) tidak gagal
        let dtfMaklonId = Number(it.dtf_maklon_id) || 0;
        if (!dtfMaklonId || dtfMaklonId <= 0) {
          const lhkNo = it.lhk_nomor || it.LhkNomor || "";
          const [[existingDtf]] = await conn.query(
            `SELECT id FROM ${MKL_DB}.tdtf_maklon WHERE mkl_nomor = ? AND lhk_nomor = ? LIMIT 1`,
            [mklNomor, lhkNo],
          );
          if (existingDtf) {
            dtfMaklonId = existingDtf.id;
          } else {
            const [[mklDtlFirst]] = await conn.query(
              `SELECT mkld_kode_polos, mkld_satuan_kirim FROM ${MKL_DB}.tmaklon_dtl WHERE mkld_mkl_nomor = ? LIMIT 1`,
              [mklNomor],
            );
            const kodePolos = it.KodePolos || it.kode_polos || mklDtlFirst?.mkld_kode_polos || "1 ROL";
            const satuan = it.Satuan || it.satuan || mklDtlFirst?.mkld_satuan_kirim || "PCS";
            const [insDtf] = await conn.query(
              `INSERT INTO ${MKL_DB}.tdtf_maklon (
                 lhk_nomor, tanggal, cab, mkl_nomor, kode_polos, qty_masuk, satuan, keterangan, user_create, date_create
               ) VALUES (?, ?, 'P05', ?, ?, ?, ?, 'Hasil Maklon Mesin Cetak MMT', ?, NOW())`,
              [
                lhkNo,
                tanggal,
                mklNomor,
                kodePolos,
                Number(it.qty_terima ?? it.QtyHasil) || 1,
                satuan,
                user?.kode || user?.kdUser || "SYSTEM",
              ],
            );
            dtfMaklonId = insDtf.insertId;
          }
        }

        await conn.query(
          `INSERT INTO ${MKL_DB}.tsj_maklon_dtl (
             sjmd_sjm_nomor, sjmd_mkld_id, sjmd_dtf_maklon_id, sjmd_dtf_maklon_hasil_id,
             sjmd_kode_jadi, sjmd_qty_terima, sjmd_qty_bs, sjmd_lhk_nomor
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nomor,
            mkldId,
            dtfMaklonId,
            it.dtf_maklon_hasil_id || null,
            it.kode_jadi || it.KodeHasil || "",
            Number(it.qty_terima ?? it.QtyHasil) || 0,
            Number(it.qty_bs ?? it.BsAfval) || 0,
            it.lhk_nomor || it.LhkNomor || "",
          ],
        );
      }
    } else {
      // Fallback: load items by create data
      const data = await getCreateData({ ids, mklNomor });
      for (const r of data.items) {
        let mkldId = r.MkldId;
        if (!mkldId) {
          const [[mkld]] = await conn.query(
            `SELECT mkld_id FROM ${MKL_DB}.tmaklon_dtl WHERE mkld_mkl_nomor = ? LIMIT 1`,
            [mklNomor],
          );
          mkldId = mkld?.mkld_id || null;
        }

        let dtfMaklonId = r.Sumber === "DTF" ? Number(r.DtfMaklonId) : 0;
        if (!dtfMaklonId || dtfMaklonId <= 0) {
          const lhkNo = r.LhkNomor || "";
          const [[existingDtf]] = await conn.query(
            `SELECT id FROM ${MKL_DB}.tdtf_maklon WHERE mkl_nomor = ? AND lhk_nomor = ? LIMIT 1`,
            [mklNomor, lhkNo],
          );
          if (existingDtf) {
            dtfMaklonId = existingDtf.id;
          } else {
            const [insDtf] = await conn.query(
              `INSERT INTO ${MKL_DB}.tdtf_maklon (
                 lhk_nomor, tanggal, cab, mkl_nomor, kode_polos, qty_masuk, satuan, keterangan, user_create, date_create
               ) VALUES (?, ?, 'P05', ?, ?, ?, ?, 'Hasil Maklon Mesin Cetak MMT', ?, NOW())`,
              [
                lhkNo,
                tanggal,
                mklNomor,
                r.KodePolos || "1 ROL",
                Number(r.QtyHasil) || 1,
                r.Satuan || "PCS",
                user?.kode || user?.kdUser || "SYSTEM",
              ],
            );
            dtfMaklonId = insDtf.insertId;
          }
        }

        await conn.query(
          `INSERT INTO ${MKL_DB}.tsj_maklon_dtl (
             sjmd_sjm_nomor, sjmd_mkld_id, sjmd_dtf_maklon_id, sjmd_dtf_maklon_hasil_id,
             sjmd_kode_jadi, sjmd_qty_terima, sjmd_qty_bs, sjmd_lhk_nomor
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nomor,
            mkldId,
            dtfMaklonId,
            r.Sumber === "DTF" ? Number(r.DtfMaklonHasilId) : null,
            r.KodeHasil,
            Number(r.QtyHasil) || 0,
            Number(r.BsAfval) || 0,
            r.LhkNomor || "",
          ],
        );
      }
    }

    // Update status maklon induk
    await recomputeStatus(conn, mklNomor);

    await conn.commit();
    return { nomor, cabPenerima, mklNomor };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const getPrintData = async (sjmNomor) => {
  const [[header]] = await pool.query(
    `SELECT h.sjm_nomor, h.sjm_tanggal, h.sjm_mkl_nomor, h.sjm_cab_penerima, h.sjm_user_create,
            m.mkl_cab_asal, m.mkl_cab_tujuan,
            ga.pab_nama AS NamaCabAsal, gt.pab_nama AS NamaCabTujuan
     FROM ${MKL_DB}.tsj_maklon_hdr h
     JOIN ${MKL_DB}.tmaklon_hdr m ON m.mkl_nomor = h.sjm_mkl_nomor
     LEFT JOIN ${MKL_DB}.tpabrik ga ON ga.pab_kode = m.mkl_cab_asal
     LEFT JOIN ${MKL_DB}.tpabrik gt ON gt.pab_kode = m.mkl_cab_tujuan
     WHERE h.sjm_nomor = ?`,
    [sjmNomor],
  );
  if (!header) throw new Error("SJ Hasil Maklon tidak ditemukan.");

  const [details] = await pool.query(
    `SELECT d.sjmd_qty_terima, d.sjmd_qty_bs, d.sjmd_kode_jadi,
            COALESCE(b.brg_nama, d.sjmd_kode_jadi) AS NamaJadi,
            COALESCE(b.brg_satuan, 'PCS') AS Satuan,
            COALESCE(NULLIF(d.sjmd_lhk_nomor, ''), dm.lhk_nomor, '-') AS LhkNomor
     FROM ${MKL_DB}.tsj_maklon_dtl d
     LEFT JOIN ${MKL_DB}.tgarmen_brg b ON b.brg_kode = d.sjmd_kode_jadi
     LEFT JOIN ${MKL_DB}.tdtf_maklon dm ON dm.id = d.sjmd_dtf_maklon_id
     WHERE d.sjmd_sjm_nomor = ?`,
    [sjmNomor],
  );

  return { header, details };
};

module.exports = {
  getOutstanding,
  getAvailableMaklon,
  getHistory,
  getHistoryDetail,
  getCreateData,
  createSjHasilMaklon,
  getPrintData,
  recomputeStatus,
};
