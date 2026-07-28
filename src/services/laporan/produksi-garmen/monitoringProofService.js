const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — replikasi query Delphi ufrmLapMonitoringProof.btnExcelClick.
// Struktur correlated subquery per MSPK_Nomor dipertahankan persis
// (dibungkus 1 derived table `t`), lalu kolom SELISIH (yang di Delphi
// murni formula Excel `=J6-E6` dkk, bukan hasil query) dihitung di
// outer query pakai DATEDIFF() supaya frontend cukup terima angka jadi.
// ⚠️ Delphi punya field `enddate` di form tapi TIDAK dipakai di query
// aslinya (cuma filter Mspk_Tanggal>=startdate, tanpa batas atas) —
// direplikasi apa adanya, single filter `startDate`.
// ⚠️ Subquery tkesesuaianmap (kolom KIRIM) LIMIT 1 tanpa ORDER BY di
// Delphi asli → nondeterministic, direplikasi apa adanya.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, cab = "P04") => {
  let where = `
    WHERE m.mspk_cmo <> ''
      AND m.mspk_tanggal >= ?
  `;
  const params = [startDate];

  if (cab === "P01") {
    where += ` AND m.mspk_cab = ?`;
    params.push("P01");
  } else if (cab === "P04") {
    where += ` AND m.mspk_cab = ?`;
    params.push("P04");
  } else {
    // ALL -> tetap dibatasi P01/P04 sesuai else-branch Delphi
    where += ` AND m.mspk_cab IN ('P01','P04')`;
  }

  const sql = `
    SELECT
      t.nama_map        AS namaMap,
      t.nomor_map       AS nomorMap,
      t.mspk_jumlah     AS order_,
      t.tgl_terbit       AS tglTerbit,
      t.tgl_dateline     AS dateline,
      t.flag_cetak       AS flagCetak,
      t.flag_bordir      AS flagBordir,
      t.tgl_minta        AS tglMinta,
      t.tgl_datang       AS tglDatang,
      t.tgl_potong       AS tglPotong,
      t.tgl_desain       AS tglDesain,
      t.tgl_cetak        AS tglCetak,
      t.tgl_bordir       AS tglBordir,
      t.tgl_jahit        AS tglJahit,
      t.tgl_kirim        AS tglKirim,
      t.qty_kirim        AS qtyKirim,
      CASE WHEN t.tgl_datang IS NULL THEN NULL
           ELSE DATEDIFF(t.tgl_datang, t.tgl_terbit) END AS selisihBahanDatang,
      CASE WHEN t.tgl_potong IS NULL THEN NULL
           ELSE DATEDIFF(t.tgl_potong, t.tgl_dateline) END AS selisihCutting,
      CASE WHEN t.tgl_desain IS NULL THEN NULL
           ELSE DATEDIFF(t.tgl_desain, t.tgl_dateline) END AS selisihDesain,
      CASE WHEN t.flag_cetak = 'YA' AND t.tgl_cetak IS NOT NULL
           THEN DATEDIFF(t.tgl_cetak, t.tgl_dateline) ELSE NULL END AS selisihCetak,
      CASE WHEN t.flag_bordir = 'YA' AND t.tgl_bordir IS NOT NULL
           THEN DATEDIFF(t.tgl_bordir, t.tgl_dateline) ELSE NULL END AS selisihBordir,
      CASE WHEN t.tgl_jahit IS NULL THEN NULL
           ELSE DATEDIFF(t.tgl_jahit, t.tgl_dateline) END AS selisihSewing,
      CASE WHEN t.tgl_kirim IS NULL THEN NULL
           ELSE DATEDIFF(t.tgl_kirim, t.tgl_dateline) END AS selisihKirim,
      (t.mspk_jumlah - t.qty_kirim) AS kekurangan
    FROM (
      SELECT
        m.mspk_nama    AS nama_map,
        m.mspk_nomor   AS nomor_map,
        m.mspk_jumlah  AS mspk_jumlah,
        m.mspk_tanggal AS tgl_terbit,
        m.mspk_dateline AS tgl_dateline,
        IF(m.mspk_sublim = 'Y', 'YA', IF(m.mspk_sablon = 'Y', 'YA', ' ')) AS flag_cetak,
        IF(m.mspk_bordir = 'Y', 'YA', ' ') AS flag_bordir,
        (SELECT h.min_tanggal FROM tmintabahan_hdr h
          WHERE h.min_spk_nomor = m.mspk_nomor
          ORDER BY h.date_create LIMIT 1) AS tgl_minta,
        (SELECT h.promin_tanggal FROM tproduksiminta_hdr h
          WHERE h.promin_spk_nomor = m.mspk_nomor
          ORDER BY h.date_create LIMIT 1) AS tgl_datang,
        (SELECT p.pf_tanggal FROM tproofgarmen_hdr p
          WHERE p.pf_lini = 'POTONG' AND p.pf_spk_nomor = m.mspk_nomor
          ORDER BY p.date_create LIMIT 1) AS tgl_potong,
        (SELECT h.ld_tanggal FROM tlhkdesign h
          WHERE h.ld_spk = m.mspk_nomor
          ORDER BY h.ld_tanggal DESC LIMIT 1) AS tgl_desain,
        (SELECT p.pf_tanggal FROM tproofgarmen_hdr p
          WHERE p.pf_lini = 'CETAK' AND p.pf_spk_nomor = m.mspk_nomor
          ORDER BY p.date_create LIMIT 1) AS tgl_cetak,
        (SELECT p.pf_tanggal FROM tproofgarmen_hdr p
          WHERE p.pf_lini = 'BORDIR' AND p.pf_spk_nomor = m.mspk_nomor
          ORDER BY p.date_create LIMIT 1) AS tgl_bordir,
        (SELECT p.pf_tanggal FROM tproofgarmen_hdr p
          WHERE p.pf_lini = 'JAHIT' AND p.pf_spk_nomor = m.mspk_nomor
          ORDER BY p.date_create LIMIT 1) AS tgl_jahit,
        (SELECT k.date_create FROM tkesesuaianmap k
          WHERE k.mspk_nomor = m.mspk_nomor LIMIT 1) AS tgl_kirim,
        m.mspk_jumlah_jadi AS qty_kirim
      FROM tmemospk m
      ${where}
    ) t
    ORDER BY t.tgl_terbit, t.nomor_map
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

module.exports = {
  getBrowse,
};
