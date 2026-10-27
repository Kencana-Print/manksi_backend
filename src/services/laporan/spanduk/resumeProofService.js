const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const DIVISI_SPANDUK = 1;
const HARI_MAKS = 11; // 0 = "<1", 11 = ">10"
const UNIT_UTAMA = ["JA", "MD", "KP"]; // selalu tampil, urutan seperti Delphi

// Rekap kelompok lama proof (Delphi: Resume Proof 2)
const KELOMPOK = [
  { label: "<1", dari: 0, sampai: 0 },
  { label: "1-4", dari: 1, sampai: 4 },
  { label: "5-10", dari: 5, sampai: 10 },
  { label: ">10", dari: 11, sampai: 11 },
];

const labelHari = (h) => (h === 0 ? "<1" : h === HARI_MAKS ? ">10" : String(h));
const dua = (v) => Math.round(v * 100) / 100;

// Resume Proof (Delphi: ufrmBrowseresumeProof + ufrmBrowseresumeProof2)
// Sumber: tproof_hdr, periode tph_tanggal (= tanggal MAP), lama = tgl proof - tph_tanggal
const getResumeProof = async (tglAwal, tglAkhir) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [DIVISI_SPANDUK, tglAwal, tglAkhir];

  const dariDanSyarat = `
    FROM kencanaprint.tproof_hdr p
    JOIN kencanaprint.tmemospk m
      ON m.mspk_nomor = p.tph_mspk_nomor AND m.mspk_divisi = ?
    WHERE p.tph_tanggal >= ?
      AND p.tph_tanggal < DATE_ADD(?, INTERVAL 1 DAY)`;

  const [[data], [[tanpa]]] = await Promise.all([
    db.query(
      `SELECT IFNULL(NULLIF(TRIM(m.mspk_perush_kode), ''), '-') AS Unit,
              CASE
                WHEN DATEDIFF(p.tph_tanggal_proof, p.tph_tanggal) < 1 THEN 0
                WHEN DATEDIFF(p.tph_tanggal_proof, p.tph_tanggal) > 10 THEN ${HARI_MAKS}
                ELSE DATEDIFF(p.tph_tanggal_proof, p.tph_tanggal)
              END AS Hari,
              COUNT(*) AS Jumlah
       ${dariDanSyarat}
         AND p.tph_tanggal_proof IS NOT NULL
       GROUP BY Unit, Hari`,
      params,
    ),
    db.query(
      `SELECT COUNT(*) AS Jumlah
       ${dariDanSyarat}
         AND p.tph_tanggal_proof IS NULL`,
      params,
    ),
  ]);

  // Daftar perusahaan: JA/MD/KP dulu, sisanya (bila ada datanya) urut abjad
  const lain = [
    ...new Set(
      data.map((r) => String(r.Unit)).filter((u) => !UNIT_UTAMA.includes(u)),
    ),
  ].sort();
  const units = [...UNIT_UTAMA, ...lain];

  // peta: hari -> unit -> jumlah
  const peta = new Map();
  for (const r of data) {
    const hari = Number(r.Hari);
    if (!peta.has(hari)) peta.set(hari, new Map());
    peta.get(hari).set(String(r.Unit), Number(r.Jumlah) || 0);
  }

  const totalPerUnit = Object.fromEntries(units.map((u) => [u, 0]));
  let total = 0;

  const rows = [];
  for (let hari = 0; hari <= HARI_MAKS; hari++) {
    const perUnit = {};
    let jumlahHari = 0;
    for (const u of units) {
      const n = peta.get(hari)?.get(u) ?? 0;
      perUnit[u] = n;
      totalPerUnit[u] += n;
      jumlahHari += n;
    }
    total += jumlahHari;
    rows.push({
      Hari: hari,
      Label: labelHari(hari),
      Per_Unit: perUnit,
      Total: jumlahHari,
    });
  }

  const rekap = KELOMPOK.map((k) => {
    const jumlah = rows
      .filter((r) => r.Hari >= k.dari && r.Hari <= k.sampai)
      .reduce((s, r) => s + r.Total, 0);
    return {
      Label: k.label,
      Jumlah: jumlah,
      Persen: total > 0 ? dua((jumlah / total) * 100) : 0,
    };
  });

  return {
    Units: units,
    Rows: rows,
    Total_Per_Unit: totalPerUnit,
    Total: total,
    Rekap: rekap,
    Tanpa_Tgl_Proof: Number(tanpa?.Jumlah) || 0,
  };
};

module.exports = { getResumeProof };
