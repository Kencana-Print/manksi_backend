const db = require("../../../config/database");

// ─────────────────────────────────────────────────────────
// Replikasi ufrmBrowseProyeksi.btnRefreshClick — TAPI direstrukturisasi
// dari CROSS JOIN tcustomer×tjenisorder (Cartesian product tanpa
// kondisi ON, lalu difilter belakangan) menjadi enumerasi pasangan
// (cus_kode, jo_kode) yang BENAR-BENAR punya transaksi (union dari 3
// sumber, masing2 sudah difilter >0 persis kondisi WHERE asli),
// baru di-JOIN ke tcustomer/tjenisorder buat ambil nama. Hasil akhir
// identik, tapi jauh lebih murah — CROSS JOIN semua customer x semua
// jenis order bisa puluhan-ribu baris cuma buat dibuang >95%-nya.
// ⚠️ Query asli TIDAK filter cus_aktif/jo_aktif sama sekali (beda dari
// modul lain) — direplikasi apa adanya.
// ⚠️ Subquery B/C/D TIDAK ada HAVING — kalau grup jumlahnya pas 0,
// tetap tampil 0.00 (bukan null/blank), asal row itu lolos filter
// gara-gara salah satu metrik LAIN positif. Direplikasi persis.
// ⚠️ Urutan params HARUS PERSIS urutan tekstual '?' — subquery B/C/D
// dipakai 2x secara tekstual (sekali di union "keys", sekali lagi di
// LEFT JOIN nilai aktual), jadi param-nya juga diduplikasi sesuai
// urutan tekstual tsb (pola bug yang sama seperti planSpkVsRealisasi).
// ─────────────────────────────────────────────────────────
const buildB = (startDate) => ({
  sql: `
    SELECT mspk_cus_kode AS cus_kode, mspk_jo_kode AS jo_kode,
      SUM(mspk_rencana_order * mspk_harga) AS total_memo
    FROM tmemospk
    WHERE mspk_tanggal >= DATE_SUB(?, INTERVAL 90 DAY)
      AND mspk_nomor NOT IN (
        SELECT spk_memo FROM tspk WHERE spk_aktif = 'Y' AND spk_tanggal < ?
      )
    GROUP BY mspk_cus_kode, mspk_jo_kode
  `,
  params: [startDate, startDate],
});

const buildC = (startDate, endDate) => ({
  sql: `
    SELECT spk_cus_kode AS cus_kode, spk_jo_kode AS jo_kode,
      SUM(spk_jumlah * spk_harga) AS total_realisasi_memo
    FROM tspk
    WHERE spk_aktif = 'Y' AND spk_tanggal >= ? AND spk_tanggal <= ?
      AND spk_memo IN (
        SELECT mspk_nomor FROM tmemospk WHERE mspk_tanggal >= DATE_SUB(?, INTERVAL 90 DAY)
      )
    GROUP BY spk_cus_kode, spk_jo_kode
  `,
  params: [startDate, endDate, startDate],
});

const buildD = (startDate, endDate) => ({
  sql: `
    SELECT spk_cus_kode AS cus_kode, spk_jo_kode AS jo_kode,
      SUM(spk_jumlah * spk_harga) AS total_realisasi_all
    FROM tspk
    WHERE spk_aktif = 'Y' AND spk_tanggal >= ? AND spk_tanggal <= ?
    GROUP BY spk_cus_kode, spk_jo_kode
  `,
  params: [startDate, endDate],
});

const getBrowse = async (startDate, endDate) => {
  // dipakai 2x tekstual — sekali di "keys" (union, difilter >0),
  // sekali di LEFT JOIN nilai aktual (tanpa filter)
  const b1 = buildB(startDate);
  const c1 = buildC(startDate, endDate);
  const d1 = buildD(startDate, endDate);
  const b2 = buildB(startDate);
  const c2 = buildC(startDate, endDate);
  const d2 = buildD(startDate, endDate);

  const sql = `
    SELECT
      k.cus_kode AS CusKode, cu.cus_nama AS CusNama,
      k.jo_kode AS JoKode, jo.jo_nama AS JoNama,
      b.total_memo AS TotalMemo,
      c.total_realisasi_memo AS RealisasiMemo,
      d.total_realisasi_all AS RealisasiAll
    FROM (
      SELECT cus_kode, jo_kode FROM (${b1.sql}) b1 WHERE IFNULL(b1.total_memo, 0) > 0
      UNION
      SELECT cus_kode, jo_kode FROM (${c1.sql}) c1 WHERE IFNULL(c1.total_realisasi_memo, 0) > 0
      UNION
      SELECT cus_kode, jo_kode FROM (${d1.sql}) d1 WHERE IFNULL(d1.total_realisasi_all, 0) > 0
    ) k
    INNER JOIN tcustomer cu ON cu.cus_kode = k.cus_kode
    INNER JOIN tjenisorder jo ON jo.jo_kode = k.jo_kode
    LEFT JOIN (${b2.sql}) b ON b.cus_kode = k.cus_kode AND b.jo_kode = k.jo_kode
    LEFT JOIN (${c2.sql}) c ON c.cus_kode = k.cus_kode AND c.jo_kode = k.jo_kode
    LEFT JOIN (${d2.sql}) d ON d.cus_kode = k.cus_kode AND d.jo_kode = k.jo_kode
    ORDER BY k.cus_kode, k.jo_kode
  `;

  const params = [
    ...b1.params,
    ...c1.params,
    ...d1.params,
    ...b2.params,
    ...c2.params,
    ...d2.params,
  ];

  const [rows] = await db.query(sql, params);

  // mysql2 balikin SUM() sebagai string — normalisasi, tapi tetap null
  // kalau memang null (bukan dipaksa 0), biar frontend bisa bedain
  // "blank" (null, LEFT JOIN gak ketemu) vs "0.00" (ketemu, sum-nya nol)
  return rows.map((r) => ({
    ...r,
    TotalMemo: r.TotalMemo !== null ? Number(r.TotalMemo) : null,
    RealisasiMemo: r.RealisasiMemo !== null ? Number(r.RealisasiMemo) : null,
    RealisasiAll: r.RealisasiAll !== null ? Number(r.RealisasiAll) : null,
  }));
};

module.exports = {
  getBrowse,
};
