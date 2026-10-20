const db = require("../../config/database");

const golongkan = (kelompok) => {
  const s = String(kelompok || "")
    .trim()
    .toUpperCase();
  if (s === "MESIN") return "MESIN";
  if (s.startsWith("MANUAL")) return "MANUAL";
  return "LAIN";
};

// Output Cutting = LHK Potong (Mutasi Produksi Potong -> QC Potong)
// P04: GP001 -> GP012, P01: GP015 -> GP021. Periode = pl_tgl1..pl_tgl2.
const withCuttingOutput = async (
  rows,
  tgl1,
  tgl2,
  prosesKey = "plan_line_kelompok",
  spkKey = "NomorSPK",
) => {
  const spkList = [...new Set(rows.map((r) => r[spkKey]).filter(Boolean))];
  if (!spkList.length) return rows.map((r) => ({ ...r, Output: 0 }));

  const [lhk] = await db.query(
    `SELECT h.mph_spk_nomor AS spk, h.mph_kelompok AS kelompok,
            IFNULL(SUM(h.mph_jumlah), 0) AS qty
     FROM tmutasiproduksi_hdr h
     WHERE h.mph_spk_nomor IN (?)
       AND ((h.mph_gdgasal = 'GP001' AND h.mph_gdgtujuan = 'GP012')
         OR (h.mph_gdgasal = 'GP015' AND h.mph_gdgtujuan = 'GP021'))
       AND h.mph_tanggal >= ? AND h.mph_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY h.mph_spk_nomor, h.mph_kelompok`,
    [spkList, tgl1, tgl2],
  );

  const bucket = {};
  for (const r of lhk) {
    const b = (bucket[r.spk] ??= { MANUAL: 0, MESIN: 0, LAIN: 0 });
    b[golongkan(r.kelompok)] += Number(r.qty) || 0;
  }

  const jumlahBaris = {};
  for (const r of rows) {
    jumlahBaris[r[spkKey]] = (jumlahBaris[r[spkKey]] || 0) + 1;
  }
  const sudah = new Set();

  return rows.map((r) => {
    const spk = r[spkKey];
    const b = bucket[spk] || { MANUAL: 0, MESIN: 0, LAIN: 0 };
    const pertama = !sudah.has(spk);
    sudah.add(spk);

    let output;
    if (jumlahBaris[spk] === 1) {
      output = b.MANUAL + b.MESIN + b.LAIN;
    } else {
      const p = r[prosesKey];
      output =
        (p === "MANUAL" || p === "MESIN" ? b[p] : 0) + (pertama ? b.LAIN : 0);
    }
    return { ...r, Output: output };
  });
};

module.exports = { withCuttingOutput };
