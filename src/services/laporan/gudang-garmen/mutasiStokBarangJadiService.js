const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — replikasi persis query Delphi btnRefreshClick.
// CATATAN: filter "tampilkanKosong=false" HANYA menghitung
// (StokAwal+STBJ+Koreksi)-SuratJalan — MutasiMasuk & MutasiKeluar
// TIDAK ikut dihitung di kondisi ini, sesuai query asli Delphi
// (pola sama seperti Mutasi Stok Bahan).
// ─────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  gudang = "",
  tampilkanKosong = false,
) => {
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
      WHERE b.brg_divisi IN (3,4,6)
    ) x
    ${
      tampilkanKosong
        ? ""
        : `WHERE ((x.StokAwal + x.Stbj + x.Koreksi) - x.SuratJalan) <> 0`
    }
    ORDER BY x.Nama
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
  ];

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per satu kode barang, difilter gudang + periode.
// ─────────────────────────────────────────────
const getDetail = async (kode, startDate, endDate, gudang = "") => {
  const gdgLike = `%${gudang}%`;

  const [awalRows] = await db.query(
    `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS awal
     FROM tmasterstok_jadi
     WHERE mst_gdg_kode LIKE ? AND mst_tanggal < ? AND mst_brg_kode = ?`,
    [gdgLike, startDate, kode],
  );
  const stokAwal = Number(awalRows[0]?.awal) || 0;

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

  return [
    {
      Transaksi: "Stok Awal",
      Nomor: "",
      Tanggal: startDate,
      StokIn: stokAwal,
      StokOut: 0,
    },
    ...trxRows,
  ];
};

// ─────────────────────────────────────────────
// ALL DETAIL — untuk tombol "Export Detail" (semua barang sesuai
// filter master saat ini, digabung jadi satu daftar flat).
// ─────────────────────────────────────────────
const getAllDetail = async (
  startDate,
  endDate,
  gudang = "",
  tampilkanKosong = false,
) => {
  const master = await getBrowse(startDate, endDate, gudang, tampilkanKosong);

  const result = [];
  for (const b of master) {
    const dtl = await getDetail(b.Kode, startDate, endDate, gudang);
    for (const d of dtl) {
      result.push({ Kode: b.Kode, Nama: b.Nama, ...d });
    }
  }
  return result;
};

module.exports = {
  getBrowse,
  getDetail,
  getAllDetail,
};
