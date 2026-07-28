const db = require("../../config/database");

const JO_EXCLUDE = `("SD","BR","PL","SB","KS")`;

// Divisi -> kolom qty planning di tplanningspk
const DIVISI_PLAN_COLUMN = {
  CUTTING: "plan_cutting",
  CETAK: "plan_cetak",
  SUBLIM: "plan_sublim",
  BORDIR: "plan_bordir",
  JAHIT: "plan_jahit",
  FINISHING: "plan_finishing",
  KIRIM: "plan_kirim",
};

// Divisi -> kode gudang asal realisasi produksi (tmutasiproduksi/tbpj).
// Tidak berlaku untuk KIRIM (sumbernya beda, dari tsj_hdr/tsj_dtl).
const DIVISI_GUDANG_MAP = {
  CUTTING: ["GP001", "GP015"],
  CETAK: ["GP002", "GP017"],
  BORDIR: ["GP014", "GP016"],
  JAHIT: ["GP003", "GP018"],
  FINISHING: ["GP004", "GP019"],
};

const REALISASI_BHN_KODE = "LL-000400"; // kode bahan proxy tracking qty produksi

// ─────────────────────────────────────────────────────────
// Helper: base filter SPK yang jadi dasar planning & realisasi
// (identik dengan modul Input Planning/Planning per Tanggal, kecuali
// JO_EXCLUDE di modul ini TIDAK menyertakan "" dan "DP","TG" — sesuai
// source Delphi asli modul ini, bukan disamakan paksa ke modul lain).
// ─────────────────────────────────────────────────────────
const buildSpkFilterSql = () => `
  s.spk_cmo <> "" AND s.spk_aktif = "Y" AND s.spk_divisi IN (3,4,6)
  AND s.spk_jo_kode NOT IN ${JO_EXCLUDE}
  AND DATE(s.spk_tanggal) BETWEEN ? AND ?
`;

// ─────────────────────────────────────────────────────────
// MASTER — 1 baris per (SPK, Divisi).
// ⚠️ FIX bug Delphi: FirstPlanning sebelumnya secara teknis MAX
// (overwrite tanpa syarat tiap baris berurutan ASC), padahal namanya
// tersirat MIN (tanggal planning paling awal). Di sini pakai
// MIN(plan_tanggal) yang benar sesuai arti namanya.
// ⚠️ Modul ini TIDAK melibatkan tmemospk (beda dari 2 modul Planning
// sebelumnya) — cuma tspk, sesuai source Delphi asli.
// ─────────────────────────────────────────────────────────
const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;
  const divisi = query.divisi || "CUTTING";
  const spkNomor = query.spkNomor || "";

  const planCol = DIVISI_PLAN_COLUMN[divisi] || DIVISI_PLAN_COLUMN.CUTTING;

  const spkExtraFilter = spkNomor ? ` AND s.spk_nomor = ?` : "";

  // Sub-query realisasi, sumber beda tergantung divisi
  let realisasiSubquery;
  const realisasiParams = [];
  if (divisi === "KIRIM") {
    realisasiSubquery = `
      SELECT d.sjd_spk_nomor AS spk, h.sj_tanggal AS tgl, d.sjd_jumlah AS jml
      FROM tsj_hdr h
      INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
      WHERE h.sj_status_otomatis = 0
    `;
  } else {
    const gudangList = DIVISI_GUDANG_MAP[divisi] || DIVISI_GUDANG_MAP.CUTTING;
    const gudangPlaceholders = gudangList.map(() => "?").join(",");
    realisasiSubquery = `
      SELECT h.mph_spk_nomor AS spk, h.mph_tanggal AS tgl, d.mpd_jumlah AS jml
      FROM tmutasiproduksi_dtl d
      INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
      WHERE d.mpd_bhn_kode = ? AND h.mph_gdgasal IN (${gudangPlaceholders})
      UNION ALL
      SELECT d.bpjd_spk AS spk, h.bpj_tanggal AS tgl, d.bpjd_jumlah AS jml
      FROM tbpj_dtl d
      INNER JOIN tbpj_hdr h ON h.bpj_nomor = d.bpjd_bpj_nomor
      WHERE d.bpjd_bhn_kode = ? AND d.bpjd_gdgp_asal IN (${gudangPlaceholders})
    `;
    realisasiParams.push(
      REALISASI_BHN_KODE,
      ...gudangList,
      REALISASI_BHN_KODE,
      ...gudangList,
    );
  }

  const sql = `
    SELECT
      s.spk_nomor AS SPK,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS TglSPK,
      s.spk_cus_kode AS KdCus,
      s.spk_nama AS Nama,
      s.spk_jumlah AS QtySPK,
      s.spk_kain AS Kain,
      s.spk_finishing AS Finishing,
      ? AS Divisi,
      DATE_FORMAT(MIN(p.plan_tanggal), '%Y-%m-%d') AS FirstPlanning,
      IFNULL(SUM(p.${planCol}), 0) AS TotPlanning,
      DATE_FORMAT(MAX(r.tgl), '%Y-%m-%d') AS LastRealisasi,
      IFNULL((SELECT SUM(r2.jml) FROM (${realisasiSubquery}) r2 WHERE r2.spk = s.spk_nomor), 0) AS TotRealisasi
    FROM tspk s
    LEFT JOIN tplanningspk p ON p.plan_spk = s.spk_nomor AND p.${planCol} <> 0
    LEFT JOIN (${realisasiSubquery}) r ON r.spk = s.spk_nomor
    WHERE ${buildSpkFilterSql()} ${spkExtraFilter}
    GROUP BY s.spk_nomor, s.spk_tanggal, s.spk_cus_kode, s.spk_nama, s.spk_jumlah, s.spk_kain, s.spk_finishing
    HAVING TotPlanning <> 0 OR TotRealisasi <> 0
    ORDER BY s.spk_nomor
  `;

  // ⚠️ FIX: realisasiSubquery muncul 2x secara TEKSTUAL di dalam SQL
  // (pertama di correlated subquery TotRealisasi/SELECT list, kedua
  // di LEFT JOIN/FROM) — keduanya harus dibind duluan SEBELUM
  // startDate/endDate, karena LEFT JOIN (posisi FROM) mendahului
  // WHERE secara tekstual walau logic-nya "LEFT JOIN kedua". Urutan
  // array params WAJIB persis sama urutan kemunculan tanda "?" di
  // teks SQL, bukan urutan logis/alfabetis.
  const params = [
    divisi,
    ...realisasiParams, // realisasiSubquery ke-1 (dalam SELECT list)
    ...realisasiParams, // realisasiSubquery ke-2 (dalam LEFT JOIN)
    startDate,
    endDate,
    ...(spkNomor ? [spkNomor] : []),
  ];

  const [rows] = await db.query(sql, params);

  return rows.map((r) => ({
    ...r,
    QtySPK: Number(r.QtySPK) || 0,
    TotPlanning: Number(r.TotPlanning) || 0,
    TotRealisasi: Number(r.TotRealisasi) || 0,
    SelisihHari:
      r.FirstPlanning && r.LastRealisasi
        ? Math.round(
            (new Date(r.LastRealisasi).getTime() -
              new Date(r.FirstPlanning).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : 0,
  }));
};

// ─────────────────────────────────────────────────────────
// DETAIL — gabungan baris Planning + Realisasi per tanggal untuk 1
// SPK+Divisi (replikasi SQLDetail Delphi, sumber ctabel2).
// ─────────────────────────────────────────────────────────
const getDetailByNomor = async (nomor, divisi) => {
  const planCol = DIVISI_PLAN_COLUMN[divisi] || DIVISI_PLAN_COLUMN.CUTTING;

  let realisasiSubquery;
  const realisasiParams = [];
  if (divisi === "KIRIM") {
    realisasiSubquery = `
      SELECT d.sjd_spk_nomor AS spk, DATE(h.sj_tanggal) AS tgl, d.sjd_jumlah AS jml
      FROM tsj_hdr h
      INNER JOIN tsj_dtl d ON d.sjd_sj_nomor = h.sj_nomor
      WHERE h.sj_status_otomatis = 0 AND d.sjd_spk_nomor = ?
    `;
    realisasiParams.push(nomor);
  } else {
    const gudangList = DIVISI_GUDANG_MAP[divisi] || DIVISI_GUDANG_MAP.CUTTING;
    const gudangPlaceholders = gudangList.map(() => "?").join(",");
    realisasiSubquery = `
      SELECT h.mph_spk_nomor AS spk, DATE(h.mph_tanggal) AS tgl, d.mpd_jumlah AS jml
      FROM tmutasiproduksi_dtl d
      INNER JOIN tmutasiproduksi_hdr h ON h.mph_nomor = d.mpd_mph_nomor
      WHERE d.mpd_bhn_kode = ? AND h.mph_gdgasal IN (${gudangPlaceholders}) AND h.mph_spk_nomor = ?
      UNION ALL
      SELECT d.bpjd_spk AS spk, DATE(h.bpj_tanggal) AS tgl, d.bpjd_jumlah AS jml
      FROM tbpj_dtl d
      INNER JOIN tbpj_hdr h ON h.bpj_nomor = d.bpjd_bpj_nomor
      WHERE d.bpjd_bhn_kode = ? AND d.bpjd_gdgp_asal IN (${gudangPlaceholders}) AND d.bpjd_spk = ?
    `;
    realisasiParams.push(
      REALISASI_BHN_KODE,
      ...gudangList,
      nomor,
      REALISASI_BHN_KODE,
      ...gudangList,
      nomor,
    );
  }

  const isKirim = divisi === "KIRIM";
  const realisasiLabel = isKirim ? "RealisasiKirim" : "RealisasiProduksi";

  const [rows] = await db.query(
    `SELECT * FROM (
       SELECT p.plan_spk AS SPK, ? AS Divisi,
              DATE_FORMAT(p.plan_tanggal, '%Y-%m-%d') AS Tanggal,
              p.${planCol} AS Plan, 0 AS ${realisasiLabel}
       FROM tplanningspk p
       WHERE p.plan_spk = ? AND p.${planCol} <> 0

       UNION ALL

       SELECT r.spk AS SPK, ? AS Divisi,
              DATE_FORMAT(r.tgl, '%Y-%m-%d') AS Tanggal,
              0 AS Plan, r.jml AS ${realisasiLabel}
       FROM (${realisasiSubquery}) r
     ) x
     ORDER BY x.Tanggal`,
    [divisi, nomor, divisi, ...realisasiParams],
  );
  return rows;
};

module.exports = {
  getBrowseList,
  getDetailByNomor,
};
