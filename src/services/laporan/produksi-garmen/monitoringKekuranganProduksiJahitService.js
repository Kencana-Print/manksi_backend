const db = require("../../../config/database");

const BHN_MARKER = "LL-000400";
const GDG_JAHIT = ["GP003", "GP018"];

const KELOMPOK_FIELD_MAP = {
  "LINE A": "LhkA",
  "LINE B": "LhkB",
  "LINE C": "LhkC",
  "LINE D": "LhkD",
  "LINE E": "LhkE",
  "LINE F": "LhkF",
  "LINE G": "LhkG",
  "LINE H": "LhkH",
  "LINE I": "LhkI",
  "LINE J": "LhkJ",
  "LINE K": "LhkK",
};

// ─────────────────────────────────────────────
// MASTER — SPK divisi garmen (3,4,6), dikelompokkan progress LHK
// Jahit per LINE (A-K, sisanya "Other"), plus CMT (jasa luar).
// ⚠️ QUIRK DIPERTAHANKAN (sengaja, bukan bug): filter cab di-comment
// di Delphi untuk query mutasi & CMT — jadi kontribusi mutasi/CMT
// SELALU dihitung total, TIDAK ikut terfilter cabang, meski baris
// SPK sendiri tetap difilter cabang di level master.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, cab = "P04") => {
  let cabFilter = "";
  const masterParams = [];
  if (cab && cab !== "ALL") {
    cabFilter = "AND s.spk_cab = ?";
    masterParams.push(cab);
  } else {
    cabFilter = "AND s.spk_cab IN ('P01', 'P04')";
  }

  const masterSql = `
    SELECT
      s.spk_nomor AS Spk,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
      IFNULL(s.spk_cab, '') AS Cab,
      v.divisi AS Divisi,
      s.spk_nama AS Nama,
      s.spk_jumlah AS JmlSpk
    FROM tspk s
    LEFT JOIN tdivisi v ON v.kode = s.spk_divisi
    WHERE s.spk_cmo <> '' AND s.spk_aktif = 'Y' AND s.spk_close = 0
      AND s.spk_divisi IN (3, 4, 6)
      ${cabFilter}
      AND s.spk_tanggal >= ?
  `;
  masterParams.push(startDate);
  const [masterRows] = await db.query(masterSql, masterParams);
  if (masterRows.length === 0) return [];

  const spkList = masterRows.map((r) => r.Spk);
  const dataMap = new Map();
  for (const r of masterRows) {
    dataMap.set(r.Spk, {
      ...r,
      LhkA: 0,
      LhkB: 0,
      LhkC: 0,
      LhkD: 0,
      LhkE: 0,
      LhkF: 0,
      LhkG: 0,
      LhkH: 0,
      LhkI: 0,
      LhkJ: 0,
      LhkK: 0,
      Other: 0,
      Cmt: 0,
    });
  }

  // ── Mutasi Produksi (Jahit), grouped by SPK + kelompok/line ──
  const mutasiSql = `
    SELECT mph_spk_nomor AS Spk, mph_kelompok AS Kelompok, SUM(mpd_jumlah) AS Jml
    FROM tmutasiproduksi_hdr
    INNER JOIN tmutasiproduksi_dtl ON mpd_mph_nomor = mph_nomor
    WHERE mpd_bhn_kode = ? AND mph_gdgasal IN (?, ?)
      AND mph_spk_nomor IN (?)
      AND mph_tanggal >= ?
    GROUP BY mph_spk_nomor, mph_kelompok
  `;
  const [mutasiRows] = await db.query(mutasiSql, [
    BHN_MARKER,
    ...GDG_JAHIT,
    spkList,
    startDate,
  ]);
  for (const r of mutasiRows) {
    const row = dataMap.get(r.Spk);
    if (!row) continue;
    const field = KELOMPOK_FIELD_MAP[r.Kelompok];
    if (field) row[field] += Number(r.Jml);
    else row.Other += Number(r.Jml);
  }

  // ── CMT (BPJ jasa luar), grouped by SPK ──
  const cmtSql = `
    SELECT bpjd_spk AS Spk, SUM(bpjd_Jumlah) AS Jml
    FROM tbpj_hdr
    INNER JOIN tbpj_dtl ON bpjd_bpj_Nomor = bpj_Nomor
    WHERE bpjd_bhn_kode = ? AND bpjd_gdgp_asal IN (?, ?)
      AND bpjd_spk IN (?)
      AND bpj_tanggal >= ?
    GROUP BY bpjd_spk
  `;
  const [cmtRows] = await db.query(cmtSql, [
    BHN_MARKER,
    ...GDG_JAHIT,
    spkList,
    startDate,
  ]);
  for (const r of cmtRows) {
    const row = dataMap.get(r.Spk);
    if (!row) continue;
    row.Cmt += Number(r.Jml);
  }

  // ── Hitung TotalLHK & Outstanding, filter hanya yang Outstanding<>0 ──
  const result = [];
  for (const row of dataMap.values()) {
    const totalLhk =
      row.LhkA +
      row.LhkB +
      row.LhkC +
      row.LhkD +
      row.LhkE +
      row.LhkF +
      row.LhkG +
      row.LhkH +
      row.LhkI +
      row.LhkJ +
      row.LhkK +
      row.Other;
    const outstanding = row.JmlSpk - (totalLhk + row.Cmt);
    if (outstanding === 0) continue;
    result.push({ ...row, TotalLhk: totalLhk, Outstanding: outstanding });
  }

  result.sort((a, b) =>
    a.Tanggal > b.Tanggal ? 1 : a.Tanggal < b.Tanggal ? -1 : 0,
  );
  return result;
};

module.exports = {
  getBrowse,
};
