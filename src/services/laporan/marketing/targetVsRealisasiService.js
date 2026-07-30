const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Replikasi ufrmLapYTD2.loaddata (Laporan Year to Date / Target vs
// Realisasi). Data digerakkan dari ttargetmarketing (LEFT JOIN ke SPK
// aggregat per bulan) — kalau ttargetmarketing belum ada row untuk
// tahun terpilih, hasilnya kosong (bukan bug query, target memang
// belum di-setup untuk tahun itu).
// ⚠️ DEVIASI SENGAJA dari Delphi: source asli PUNYA combo "Periode"
// (cbbBulan) di form tapi TIDAK PERNAH dipakai di query loaddata —
// selalu return semua bulan yang ada row targetnya untuk tahun
// terpilih. Di web ini filter bulan BENERAN diterapkan (WHERE
// tm.tm_periode = ?) sesuai permintaan eksplisit, param `bulan`
// opsional — kosongkan untuk lihat semua bulan (persis behavior
// Delphi aslinya).
// ⚠️ Urutan param HARUS PERSIS urutan tekstual '?': tahun-1 (subquery
// LAST_YEAR), tahun-1 lagi (subquery %GROWTH denominator), tahun
// (derived table 'a'), tahun (WHERE tm_tahun), lalu bulan (opsional).
// ─────────────────────────────────────────────────────────
const getBrowse = async (tahun, bulan = "") => {
  const tahunNum = Number(tahun);
  if (!tahunNum || tahunNum < 2000 || tahunNum > 2100) {
    throw new Error("Tahun tidak valid.");
  }
  const tahunLalu = tahunNum - 1;

  let where = " WHERE tm.tm_tahun = ?";
  const params = [tahunLalu, tahunLalu, tahunNum, tahunNum];

  if (bulan) {
    where += " AND tm.tm_periode = ?";
    params.push(bulan);
  }

  const sql = `
    SELECT
      tm.tm_tahun AS tahun,
      UPPER(MONTHNAME(STR_TO_DATE(tm.tm_periode, '%m'))) AS bulanLabel,
      tm.tm_periode AS bulanNomor,
      tm.tm_target AS target,
      a.nilai AS realisasi,
      IF(tm.tm_target > 0 AND IFNULL(a.nilai, 0) > 0,
         IFNULL(a.nilai, 0) / tm.tm_target, NULL) * 100 AS pctAch,
      (SELECT SUM(IFNULL(s.spk_jumlah, 0) * IFNULL(s.spk_harga, 0))
        FROM tspk s
        WHERE s.spk_aktif = 'Y'
          AND YEAR(s.spk_tanggal) = ?
          AND MONTH(s.spk_tanggal) = tm.tm_periode) AS realisasiTahunLalu,
      (
        (a.nilai / (SELECT SUM(IFNULL(s.spk_jumlah, 0) * IFNULL(s.spk_harga, 0))
                      FROM tspk s
                      WHERE s.spk_aktif = 'Y'
                        AND YEAR(s.spk_tanggal) = ?
                        AND MONTH(s.spk_tanggal) = tm.tm_periode)) - 1
      ) * 100 AS pctGrowth
    FROM ttargetmarketing tm
    LEFT JOIN (
      SELECT YEAR(s.spk_tanggal) AS tahun, MONTH(s.spk_tanggal) AS bulan,
        SUM(IFNULL(s.spk_jumlah, 0) * IFNULL(s.spk_harga, 0)) AS nilai
      FROM tspk s
      WHERE s.spk_aktif = 'Y' AND YEAR(s.spk_tanggal) = ?
      GROUP BY MONTH(s.spk_tanggal)
    ) a ON a.bulan = tm.tm_periode AND a.tahun = tm.tm_tahun
    ${where}
    ORDER BY tm.tm_periode
  `;

  const [rows] = await db.query(sql, params);

  // mysql2 balikin SUM()/DECIMAL sebagai string — normalisasi
  return rows.map((r) => ({
    ...r,
    target: r.target !== null ? Number(r.target) : null,
    realisasi: r.realisasi !== null ? Number(r.realisasi) : null,
    pctAch: r.pctAch !== null ? Number(r.pctAch) : null,
    realisasiTahunLalu:
      r.realisasiTahunLalu !== null ? Number(r.realisasiTahunLalu) : null,
    pctGrowth: r.pctGrowth !== null ? Number(r.pctGrowth) : null,
  }));
};

module.exports = {
  getBrowse,
};
