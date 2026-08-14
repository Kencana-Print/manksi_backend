const db = require("../../config/database");

// ─────────────────────────────────────────────────────────
// SEARCH BAHAN — gabungan stok (barcode) + pergerakan terakhir
// (permintaan dari tproduksiminta, realisasi dari kartu stok
// bahan GB001 prefix PROG). Basis untuk semua fitur turunan
// (slow moving, reminder MAP, dst).
// ─────────────────────────────────────────────────────────
const searchBahan = async (keyword = "", onlyWithStok = true) => {
  let where = `WHERE b.bhn_aktif = 0`;
  const params = [];

  if (keyword) {
    where += ` AND (b.bhn_name LIKE ? OR b.bhn_kode LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const sql = `
    SELECT
      b.bhn_kode      AS Kode,
      b.bhn_name      AS Nama,
      b.bhn_satuan    AS Satuan,
      b.bhn_gramasi   AS Gramasi,
      b.bhn_hargabeli AS HargaBeli,
      IFNULL(stok.Stok, 0) AS Stok,
      ROUND(IFNULL(stok.Stok, 0) * IFNULL(b.bhn_hargabeli, 0)) AS NilaiStok,
      perm.LastPermintaan,
      rls.LastRealisasi,
      IF(perm.LastPermintaan IS NULL AND rls.LastRealisasi IS NULL, 0, 1) AS PernahBergerak,
      IF(
        perm.LastPermintaan IS NULL AND rls.LastRealisasi IS NULL,
        NULL,
        GREATEST(IFNULL(perm.LastPermintaan, '1900-01-01'), IFNULL(rls.LastRealisasi, '1900-01-01'))
      ) AS LastPergerakan,
      IF(
        perm.LastPermintaan IS NULL AND rls.LastRealisasi IS NULL,
        NULL,
        TIMESTAMPDIFF(
          MONTH,
          GREATEST(IFNULL(perm.LastPermintaan, '1900-01-01'), IFNULL(rls.LastRealisasi, '1900-01-01')),
          CURDATE()
        )
      ) AS BulanTanpaGerak
    FROM tbahan b
    LEFT JOIN (
      SELECT LEFT(mst_brg_kode, LENGTH(mst_brg_kode) - 7) AS Kode,
             SUM(mst_stok_in - mst_stok_out) AS Stok
      FROM tmasterstok_barcode
      WHERE mst_aktif = 'Y'
      GROUP BY Kode
    ) stok ON stok.Kode = b.bhn_kode
    LEFT JOIN (
      SELECT d.promind_bhn_kode AS Kode, MAX(h.promin_tanggal) AS LastPermintaan
      FROM tproduksiminta_dtl d
      INNER JOIN tproduksiminta_hdr h ON h.promin_nomor = d.promind_promin_Nomor
      GROUP BY d.promind_bhn_kode
    ) perm ON perm.Kode = b.bhn_kode
    LEFT JOIN (
      SELECT mst_brg_kode AS Kode, MAX(mst_tanggal) AS LastRealisasi
      FROM tmasterstok_bahan
      WHERE mst_aktif = 'Y' AND mst_gdg_kode = 'GB001'
        AND LEFT(mst_noreferensi, 4) = 'PROG' AND mst_stok_out > 0
      GROUP BY mst_brg_kode
    ) rls ON rls.Kode = b.bhn_kode
    ${where}
    ${onlyWithStok ? "AND IFNULL(stok.Stok, 0) > 0" : ""}
    ORDER BY PernahBergerak ASC, LastPergerakan ASC, b.bhn_name ASC
  `;

  const [rows] = await db.query(sql, params);
  return rows.map((r) => ({
    ...r,
    Stok: Number(r.Stok) || 0,
    NilaiStok: Number(r.NilaiStok) || 0,
    HargaBeli: Number(r.HargaBeli) || 0,
    PernahBergerak: !!r.PernahBergerak,
    BulanTanpaGerak:
      r.BulanTanpaGerak === null ? null : Number(r.BulanTanpaGerak),
  }));
};

// ─────────────────────────────────────────────────────────
// SLOW MOVING — wrapper searchBahan + filter threshold tahun.
// minTahun fleksibel (default 3), dilempar dari query param.
// Bahan yang belum pernah bergerak sama sekali (PernahBergerak
// = false) SELALU masuk, terlepas dari minTahun.
// ─────────────────────────────────────────────────────────
const getSlowMoving = async (keyword = "", minTahun = 3) => {
  const all = await searchBahan(keyword, true);
  const batasBulan = Number(minTahun) * 12;
  return all.filter(
    (r) =>
      !r.PernahBergerak ||
      (r.BulanTanpaGerak !== null && r.BulanTanpaGerak >= batasBulan),
  );
};

// ─────────────────────────────────────────────────────────
// REMINDER — versi ringkas untuk dipanggil dari form MAP/SPK/SO
// saat user ketik nama kain. Cuma bahan slow moving yang masuk,
// dibatasi jumlah hasil biar ringan buat typeahead.
// ─────────────────────────────────────────────────────────
const getReminderKain = async (keyword, minTahun = 3, limit = 5) => {
  if (!keyword || keyword.trim().length < 3) return [];
  const rows = await getSlowMoving(keyword.trim(), minTahun);
  return rows.slice(0, Number(limit)).map((r) => ({
    Kode: r.Kode,
    Nama: r.Nama,
    Satuan: r.Satuan,
    Stok: r.Stok,
    NilaiStok: r.NilaiStok,
    BulanTanpaGerak: r.BulanTanpaGerak,
    PernahBergerak: r.PernahBergerak,
  }));
};

// ─────────────────────────────────────────────────────────
// KARTU PERGERAKAN — drill-down detail per kode bahan, gabungan
// riwayat Permintaan (tproduksiminta) + Realisasi/Pemakaian
// (tmasterstok_bahan prefix PROG), diurut kronologis terbaru dulu.
// ─────────────────────────────────────────────────────────
const getKartuPergerakan = async (kode, startDate = null, endDate = null) => {
  let dateFilterPerm = "";
  let dateFilterReal = "";
  const paramsPerm = [kode];
  const paramsReal = [kode];

  if (startDate) {
    dateFilterPerm += ` AND h.promin_tanggal >= ?`;
    dateFilterReal += ` AND m.mst_tanggal >= ?`;
    paramsPerm.push(startDate);
    paramsReal.push(startDate);
  }
  if (endDate) {
    dateFilterPerm += ` AND h.promin_tanggal <= ?`;
    dateFilterReal += ` AND m.mst_tanggal <= ?`;
    paramsPerm.push(endDate);
    paramsReal.push(endDate);
  }

  const sql = `
    SELECT * FROM (
      SELECT
        'PERMINTAAN' AS Jenis,
        h.promin_nomor AS Nomor,
        DATE_FORMAT(h.promin_tanggal, '%Y-%m-%d') AS Tanggal,
        d.promind_Jumlah AS Jumlah,
        h.promin_spk_nomor AS SpkNomor,
        g.gdgp_nama AS Gudang
      FROM tproduksiminta_dtl d
      INNER JOIN tproduksiminta_hdr h ON h.promin_nomor = d.promind_promin_Nomor
      LEFT JOIN tgudangproduksi g ON g.gdgp_kode = h.promin_gdgp_kode
      WHERE d.promind_bhn_kode = ? ${dateFilterPerm}
      UNION ALL
      SELECT
        'REALISASI' AS Jenis,
        m.mst_noreferensi AS Nomor,
        DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d') AS Tanggal,
        m.mst_stok_out AS Jumlah,
        NULL AS SpkNomor,
        'GB001' AS Gudang
      FROM tmasterstok_bahan m
      WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
        AND LEFT(m.mst_noreferensi, 4) = 'PROG'
        AND m.mst_brg_kode = ? ${dateFilterReal}
    ) x
    ORDER BY x.Tanggal DESC, x.Jenis
  `;

  const [rows] = await db.query(sql, [...paramsPerm, ...paramsReal]);
  return rows.map((r) => ({ ...r, Jumlah: Number(r.Jumlah) || 0 }));
};

module.exports = {
  searchBahan,
  getSlowMoving,
  getReminderKain,
  getKartuPergerakan,
};
