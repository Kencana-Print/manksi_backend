const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — replikasi persis query Delphi btnRefreshClick.
// Kode Barang WAJIB diisi (bukan opsional seperti Kartu Stok Bahan).
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, kode, gudang = "") => {
  if (!kode) throw new Error("Nama Barang harus diisi.");

  const gdgLike = `%${gudang}%`;

  const sql = `
    SELECT x.*,
      ((x.StokAwal + x.Stbj + x.MutasiMasuk + x.Koreksi)
        - (x.SuratJalan + x.MutasiKeluar)) AS StokAkhir
    FROM (
      SELECT
        b.brg_kode   AS Kode,
        b.brg_name   AS Nama,
        b.brg_ukuran AS Ukuran,
        IFNULL((
          SELECT SUM(m.mst_stok_in - m.mst_stok_out)
          FROM tmasterstok_jadi m
          WHERE m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal < ? AND m.mst_brg_kode = b.brg_kode
        ), 0) AS StokAwal,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_jadi m
          WHERE m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 4) = 'STBJ' AND m.mst_brg_kode = b.brg_kode
        ), 0) AS Stbj,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_jadi m
          WHERE m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'BJM' AND m.mst_brg_kode = b.brg_kode
        ), 0) AS MutasiMasuk,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_jadi m
          WHERE m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'KOR' AND m.mst_brg_kode = b.brg_kode
        ), 0) AS Koreksi,
        IFNULL((
          SELECT SUM(m.mst_stok_out)
          FROM tmasterstok_jadi m
          WHERE m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 2) = 'SG' AND m.mst_brg_kode = b.brg_kode
        ), 0) AS SuratJalan,
        IFNULL((
          SELECT SUM(m.mst_stok_out)
          FROM tmasterstok_jadi m
          WHERE m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'BJK' AND m.mst_brg_kode = b.brg_kode
        ), 0) AS MutasiKeluar
      FROM tbarang b
      WHERE b.brg_divisi IN (3,4,6) AND b.brg_kode = ?
    ) x
  `;

  const params = [
    gdgLike,
    startDate,
    gdgLike,
    startDate,
    endDate,
    gdgLike,
    startDate,
    endDate,
    gdgLike,
    startDate,
    endDate,
    gdgLike,
    startDate,
    endDate,
    gdgLike,
    startDate,
    endDate,
    kode,
  ];

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — running balance kumulatif per baris transaksi,
// dimulai dari StokAwal (sesuai variabel xStok di Delphi yang
// terus diakumulasi tiap baris berurutan, bukan hitung per baris
// independen).
// ─────────────────────────────────────────────
const getDetail = async (kode, startDate, endDate, gudang = "") => {
  const gdgLike = `%${gudang}%`;

  const [awalRows] = await db.query(
    `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS awal
     FROM tmasterstok_jadi
     WHERE mst_tanggal < ? AND mst_gdg_kode LIKE ? AND mst_brg_kode = ?`,
    [startDate, gdgLike, kode],
  );
  let xStok = Number(awalRows[0]?.awal) || 0;

  const [trxRows] = await db.query(
    `SELECT
       m.mst_noreferensi AS Nomor,
       DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d') AS Tanggal,
       m.mst_stok_in  AS StokIn,
       m.mst_stok_out AS StokOut,
       IF(LEFT(m.mst_noreferensi,4)='STBJ','STBJ',
         IF(LEFT(m.mst_noreferensi,3)='BJM','Mutasi Masuk',
           IF(LEFT(m.mst_noreferensi,3)='KOR','Koreksi',
             IF(LEFT(m.mst_noreferensi,2)='SG','Surat Jalan',
               IF(LEFT(m.mst_noreferensi,3)='BJK','Mutasi Keluar','')
             )
           )
         )
       ) AS Transaksi
     FROM tmasterstok_jadi m
     WHERE m.mst_gdg_kode LIKE ? AND m.mst_brg_kode = ?
       AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
     ORDER BY m.date_create`,
    [gdgLike, kode, startDate, endDate],
  );

  const detail = [
    {
      Kode: kode,
      Transaksi: "Stok Awal",
      Nomor: "",
      Tanggal: startDate,
      StokIn: xStok,
      StokOut: 0,
      StokAkhir: xStok,
    },
  ];

  for (const t of trxRows) {
    xStok = xStok + Number(t.StokIn) - Number(t.StokOut);
    detail.push({
      Kode: kode,
      Transaksi: t.Transaksi,
      Nomor: t.Nomor,
      Tanggal: t.Tanggal,
      StokIn: t.StokIn,
      StokOut: t.StokOut,
      StokAkhir: xStok,
    });
  }

  return detail;
};

// ─────────────────────────────────────────────
// ALL DETAIL — untuk "Export Detail". Karena kode wajib diisi
// (satu barang per pencarian, bukan daftar banyak barang seperti
// Kartu Stok Bahan), all-detail di sini SAMA dengan getDetail biasa
// — disediakan terpisah untuk konsistensi pola endpoint dgn laporan
// lain dan kemudahan pemakaian di frontend (tombol Export Detail).
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, kode, gudang = "") => {
  return getDetail(kode, startDate, endDate, gudang);
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
