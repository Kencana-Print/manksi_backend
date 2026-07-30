const db = require("../../../config/database");

/**
 * ═══════════════════════════════════════════════════════════
 * MONITORING TARGET VS ACHIEVEMENT
 * Migrasi dari ufrmlapAchievement.pas (Delphi)
 *
 * ⚠️ Flag hak akses: TIDAK ADA satupun (zcus/zLihatHarga/zLihatBeli/
 * zLihatSup) yang dicek di source ini — modul murni data agregat
 * target/realisasi, tidak ada data customer. Tidak ada gating yang
 * perlu direplikasi.
 *
 * ⚠️ PENTING: Delphi loaddata() me-load SEMUA 4 tab sekaligus saat
 * tombol Tampil/Refresh diklik (bukan lazy per-tab). getBrowse() di
 * bawah mengikuti pola ini — mengembalikan ke-4 dataset bareng.
 *
 * ⚠️ Sales Performance & Proyeksi HANYA difilter tahun — TIDAK ikut
 * filter periode bulan (sesuai ssql3/ssql4 Delphi yang tidak pakai
 * klausa "bulan between").
 * ═══════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────
// TAB 1 — BY DIVISI
// Footer Ach% BUKAN rata-rata kolom ach, tapi dihitung ulang:
// SUM(realisasi)/SUM(target)*100 — replikasikan di frontend, jangan
// AVG(ach). (Lihat Items2GetText Delphi.)
// ─────────────────────────────────────────────────────────
const getByDivisi = async (tahun, bulanAwal, bulanAkhir) => {
  const bulanLabel = `${String(bulanAwal).padStart(2, "0")} s.d ${String(bulanAkhir).padStart(2, "0")}`;

  const sql = `
    SELECT
      tahun,
      ? AS Bulan,
      ket AS Divisi,
      SUM(IFNULL(rp_target, 0)) AS Target,
      SUM(IFNULL(rp_realisasi, 0)) AS Realisasi,
      SUM(IFNULL(rp_realisasi, 0)) / SUM(IFNULL(rp_target, 0)) * 100 AS Ach
    FROM v_ach_mkt
    WHERE tahun = ?
      AND bulan BETWEEN ? AND ?
      AND ket COLLATE utf8mb4_general_ci <> 'all'
    GROUP BY tahun, ket
  `;
  const [rows] = await db.query(sql, [
    bulanLabel,
    tahun,
    bulanAwal,
    bulanAkhir,
  ]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// TAB 2 — BY SALES
// Union 3-bagian: per-sales (urut=1), sub-total per group_sales
// (urut=2, sal_nama="SUB TOTAL"), grand total (urut=3,
// group_sales="ZZZZ", sal_nama="GRAND TOTAL"). Diurutkan supaya
// grand total selalu di paling bawah (group_sales "ZZZZ" > semua
// kode group sales asli — replikasi persis trik Delphi).
// ─────────────────────────────────────────────────────────
const getBySales = async (tahun, bulanAwal, bulanAkhir) => {
  const sql = `
    SELECT * FROM (
      SELECT
        tahun,
        CONCAT(?, ' s.d ', ?) AS Bulan,
        group_sales COLLATE utf8mb4_general_ci AS GroupSales,
        CAST(sal_kode AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_general_ci AS SalKode,
        CAST(sal_nama AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_general_ci AS SalNama,
        SUM(target) AS Target,
        SUM(realisasi) AS Realisasi,
        ROUND(SUM(realisasi) / NULLIF(SUM(target), 0) * 100, 2) AS Ach,
        1 AS Urut
      FROM v_omsetbysales
      WHERE tahun = ? AND bulan BETWEEN ? AND ?
      GROUP BY tahun, group_sales, sal_kode, sal_nama

      UNION ALL

      SELECT
        tahun,
        CONCAT(?, ' s.d ', ?) AS Bulan,
        group_sales COLLATE utf8mb4_general_ci AS GroupSales,
        '' COLLATE utf8mb4_general_ci AS SalKode,
        'SUB TOTAL' COLLATE utf8mb4_general_ci AS SalNama,
        SUM(target) AS Target,
        SUM(realisasi) AS Realisasi,
        ROUND(SUM(realisasi) / NULLIF(SUM(target), 0) * 100, 2) AS Ach,
        2 AS Urut
      FROM v_omsetbysales
      WHERE tahun = ? AND bulan BETWEEN ? AND ?
      GROUP BY tahun, group_sales

      UNION ALL

      SELECT
        tahun,
        CONCAT(?, ' s.d ', ?) AS Bulan,
        'ZZZZ' COLLATE utf8mb4_general_ci AS GroupSales,
        '' COLLATE utf8mb4_general_ci AS SalKode,
        'GRAND TOTAL' COLLATE utf8mb4_general_ci AS SalNama,
        SUM(target) AS Target,
        SUM(realisasi) AS Realisasi,
        ROUND(SUM(realisasi) / NULLIF(SUM(target), 0) * 100, 2) AS Ach,
        3 AS Urut
      FROM v_omsetbysales
      WHERE tahun = ? AND bulan BETWEEN ? AND ?
      GROUP BY tahun
    ) x
    ORDER BY GroupSales, Urut, SalKode
  `;
  const bAwal = String(bulanAwal).padStart(2, "0");
  const bAkhir = String(bulanAkhir).padStart(2, "0");
  const params = [
    bAwal,
    bAkhir,
    tahun,
    bulanAwal,
    bulanAkhir,
    bAwal,
    bAkhir,
    tahun,
    bulanAwal,
    bulanAkhir,
    bAwal,
    bAkhir,
    tahun,
    bulanAwal,
    bulanAkhir,
  ];
  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────────────────
// TAB 3 — SALES PERFORMANCE
// HANYA filter tahun (tidak ikut filter periode bulan). Styling
// baris di Delphi (QUARTER/GRAND TOTAL/negative value merah)
// direplikasi via metadata nama_bulan & nilai negatif — logic
// warna dipindah ke frontend, bukan di query.
// ─────────────────────────────────────────────────────────
const getSalesPerformance = async (tahun) => {
  const sql = `
    SELECT
      tahun, kuartal, bulan, nama_bulan,
      target, aktual, acv, ly,
      ROUND(aktual / ly * 100, 2) AS yoy,
      (aktual - ly) AS growth_rupiah,
      ROUND((aktual - ly) / ly * 100, 2) AS growth_persen,
      run_target, run_aktual, run_acv, run_ly,
      ROUND(run_aktual / run_ly * 100, 2) AS run_yoy,
      (run_aktual - run_ly) AS run_growth_rupiah,
      ROUND((run_aktual - run_ly) / run_ly * 100, 2) AS run_growth_persen,
      run_proyeksi,
      ROUND(aktual / run_proyeksi * 100, 2) AS persen_proyeksi
    FROM v_yoy
    WHERE tahun = ?
  `;
  const [rows] = await db.query(sql, [tahun]);
  return rows;
};

// ─────────────────────────────────────────────────────────
// TAB 4 — PROYEKSI
// Auto-generate 12 baris bulan (1-12) untuk tahun terpilih kalau
// belum ada di tproyeksi (replikasi INSERT IGNORE + WITH RECURSIVE
// Delphi). ⚠️ ASUMSI: tproyeksi punya UNIQUE KEY (py_tahun, py_bulan)
// supaya INSERT IGNORE tidak duplikat — perlu diverifikasi struktur
// tabelnya; kalau tidak ada unique key, INSERT IGNORE akan tetap
// insert baris duplikat setiap refresh.
// ─────────────────────────────────────────────────────────
const getProyeksi = async (tahun) => {
  const insertSql = `
    INSERT IGNORE INTO tproyeksi (py_tahun, py_bulan, py_sales)
    WITH RECURSIVE Bulan AS (
      SELECT 1 AS Bulan
      UNION ALL
      SELECT Bulan + 1 FROM Bulan WHERE Bulan < 12
    )
    SELECT ? AS Tahun, Bulan, 0 FROM Bulan
  `;
  await db.query(insertSql, [tahun]);

  const [rows] = await db.query(
    `SELECT * FROM tproyeksi WHERE py_tahun = ? ORDER BY py_bulan`,
    [tahun],
  );
  return rows;
};

// ─────────────────────────────────────────────────────────
// UPDATE PROYEKSI — inline edit per baris (replikasi
// cxGridDBBandedColumn18PropertiesEditValueChanged -> ApplyUpdates)
// ─────────────────────────────────────────────────────────
const updateProyeksi = async (tahun, bulan, pySales) => {
  if (!tahun || !bulan) throw new Error("Tahun dan bulan wajib diisi.");
  await db.query(
    `UPDATE tproyeksi SET py_sales = ? WHERE py_tahun = ? AND py_bulan = ?`,
    [Number(pySales) || 0, tahun, bulan],
  );
  return { tahun, bulan, py_sales: Number(pySales) || 0 };
};

// ─────────────────────────────────────────────────────────
// GABUNGAN — sesuai perilaku btnTampilClick Delphi: load ke-4
// dataset sekaligus dalam satu request.
// ─────────────────────────────────────────────────────────
const getBrowse = async (tahun, bulanAwal, bulanAkhir) => {
  const [byDivisi, bySales, salesPerformance, proyeksi] = await Promise.all([
    getByDivisi(tahun, bulanAwal, bulanAkhir),
    getBySales(tahun, bulanAwal, bulanAkhir),
    getSalesPerformance(tahun),
    getProyeksi(tahun),
  ]);
  return { byDivisi, bySales, salesPerformance, proyeksi };
};

module.exports = {
  getBrowse,
  getByDivisi,
  getBySales,
  getSalesPerformance,
  getProyeksi,
  updateProyeksi,
};
