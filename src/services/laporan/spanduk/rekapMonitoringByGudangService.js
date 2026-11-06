const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Kelompok jenis SPK (prefix nomor), sama seperti Delphi
const JENIS_SPK = ["JA", "MD", "KP", "AI", "SM"];

// Sumber tiap jenis LHK. Quiring dibuat terpisah karena satu baris detail
// dipecah menjadi 4 kelompok (KOLI/OVEN/JEMURAN/POTONG).
const SUMBER = {
  CETAK: {
    hdr: "tlhk_cetak_hdr",
    dtl: "tlhk_cetak_dtl",
    hdrNomor: "lch_nomor",
    dtlNomor: "lcd_lch_nomor",
    tgl: "lch_tanggal",
    pab: "lch_pab_kode",
    spk: "lcd_spk_nomor",
    qty: "lcd_qty_Cetak",
  },
  JAHIT: {
    hdr: "tlhk_jahit_hdr",
    dtl: "tlhk_jahit_dtl",
    hdrNomor: "ljh_nomor",
    dtlNomor: "ljd_ljh_nomor",
    tgl: "ljh_tanggal",
    pab: "ljh_pab_kode",
    spk: "ljd_spk_nomor",
    qty: "ljd_qty_jahit",
  },
  LIPAT: {
    hdr: "tlhk_lipat_hdr",
    dtl: "tlhk_lipat_dtl",
    hdrNomor: "llh_nomor",
    dtlNomor: "lld_llh_nomor",
    tgl: "llh_tanggal",
    pab: "llh_pab_kode",
    spk: "lld_spk_nomor",
    qty: "lld_qty_lipat",
  },
};

const galat = (pesan, status = 400) => {
  const e = new Error(pesan);
  e.status = status;
  return e;
};

// Hasil: baris (spk_nomor, kelompok, qty). Periode dipakai 1x -> 2 parameter.
const sqlSumber = (jenis) => {
  const periode = (kolom) =>
    `${kolom} >= ? AND ${kolom} < DATE_ADD(?, INTERVAL 1 DAY)`;

  if (jenis === "QUIRING") {
    return `
      SELECT d.lqd_spk_nomor AS spk_nomor,
             x.kelompok,
             IFNULL(CASE x.kelompok
                      WHEN 'KOLI'    THEN d.lqd_j_koli
                      WHEN 'OVEN'    THEN d.lqd_j_oven
                      WHEN 'JEMURAN' THEN d.lqd_j_jemuran
                      ELSE d.lqd_j_potong
                    END, 0) AS qty
      FROM kencanaprint.tlhk_quiring_hdr h
      INNER JOIN kencanaprint.tlhk_quiring_dtl d ON d.lqd_lqh_nomor = h.lqh_nomor
      CROSS JOIN (
        SELECT 'KOLI' AS kelompok UNION ALL SELECT 'OVEN'
        UNION ALL SELECT 'JEMURAN' UNION ALL SELECT 'POTONG'
      ) x
      WHERE ${periode("h.lqh_tanggal")}`;
  }

  const s = SUMBER[jenis];
  return `
      SELECT d.${s.spk} AS spk_nomor,
             h.${s.pab} AS kelompok,
             IFNULL(d.${s.qty}, 0) AS qty
      FROM kencanaprint.${s.hdr} h
      INNER JOIN kencanaprint.${s.dtl} d ON d.${s.dtlNomor} = h.${s.hdrNomor}
      WHERE ${periode(`h.${s.tgl}`)}`;
};

const getRekapMonitoringByGudang = async (tglAwal, tglAkhir, jenis) => {
  validasiPeriode(tglAwal, tglAkhir);

  const jenisUp = String(jenis || "")
    .toUpperCase()
    .trim();
  if (jenisUp !== "QUIRING" && !SUMBER[jenisUp]) {
    throw galat("Jenis harus CETAK, JAHIT, LIPAT, atau QUIRING.");
  }

  const cocok = (j) =>
    `(a.spk_nomor LIKE '${j}%' OR a.spk_nomor LIKE 'MAP-${j}%')`;
  const meter = "a.qty * IFNULL(s.spk_panjang, 0)";

  const kolomPcs = JENIS_SPK.map(
    (j) => `SUM(CASE WHEN ${cocok(j)} THEN a.qty ELSE 0 END) AS Pcs_${j}`,
  ).join(",\n      ");
  const kolomMeter = JENIS_SPK.map(
    (j) => `SUM(CASE WHEN ${cocok(j)} THEN ${meter} ELSE 0 END) AS Meter_${j}`,
  ).join(",\n      ");

  const [rows] = await db.query(
    `
    SELECT
      a.kelompok AS Kelompok,
      ${kolomPcs},
      SUM(a.qty) AS Pcs_Total,
      ${kolomMeter},
      SUM(${meter}) AS Meter_Total
    FROM (
      SELECT t.spk_nomor, t.kelompok, SUM(t.qty) AS qty
      FROM (${sqlSumber(jenisUp)}
      ) t
      GROUP BY t.spk_nomor, t.kelompok
    ) a
    LEFT JOIN (
      SELECT spk_nomor, IFNULL(spk_panjang, 0) AS spk_panjang
      FROM kencanaprint.tspk
      UNION ALL
      SELECT mspk_nomor, IFNULL(mspk_panjang, 0)
      FROM kencanaprint.tmemospk
    ) s ON s.spk_nomor = a.spk_nomor
    GROUP BY a.kelompok
    ORDER BY a.kelompok
    `,
    [tglAwal, tglAkhir],
  );

  return rows.map((r) => {
    const o = { Kelompok: r.Kelompok };
    for (const k of Object.keys(r)) {
      if (k !== "Kelompok") o[k] = dua(r[k]);
    }
    return o;
  });
};

module.exports = { getRekapMonitoringByGudang };
