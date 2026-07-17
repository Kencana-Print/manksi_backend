const db = require("../../../config/database");

// ─────────────────────────────────────────────
// MASTER — replikasi persis query Delphi btnRefreshClick.
// CATATAN: filter "tampilkanKosong=false" sengaja HANYA menghitung
// (StokAwal+BPB_Bahan+ReturMaterial+Koreksi)-PermintaanMaterial —
// MutasiMasuk & MutasiKeluar TIDAK ikut dihitung di kondisi ini,
// sesuai query asli Delphi (bukan salah replikasi).
// ─────────────────────────────────────────────
const getBrowse = async (
  startDate,
  endDate,
  gudang = "",
  tampilkanKosong = false,
) => {
  const sql = `
    SELECT x.*,
      ((x.StokAwal + x.BpbBahan + x.ReturMaterial + x.MutasiMasuk + x.Koreksi)
        - (x.PermintaanMaterial + x.MutasiKeluar)) AS StokAkhir
    FROM (
      SELECT
        b.bhn_kode      AS Kode,
        b.bhn_name      AS Nama,
        b.bhn_satuan    AS Satuan,
        b.bhn_gramasi   AS Gramasi,
        b.bhn_hargabeli AS HargaBeli,
        IFNULL((
          SELECT SUM(m.mst_stok_in - m.mst_stok_out)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal < ? AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS StokAwal,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'PBG' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS BpbBahan,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 4) = 'RETP' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS ReturMaterial,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'BBM' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS MutasiMasuk,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'KOR' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS Koreksi,
        IFNULL((
          SELECT SUM(m.mst_stok_out)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 4) = 'PROG' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS PermintaanMaterial,
        IFNULL((
          SELECT SUM(m.mst_stok_out)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'BBK' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS MutasiKeluar
      FROM tbahan b
      WHERE b.bhn_aktif = 0
    ) x
    ${
      tampilkanKosong
        ? ""
        : `WHERE ((x.StokAwal + x.BpbBahan + x.ReturMaterial + x.Koreksi) - x.PermintaanMaterial) <> 0`
    }
    ORDER BY x.Nama
  `;

  const gdgLike = `%${gudang}%`;
  // 1 (StokAwal: gdg+tgl) + 6 subquery lain (masing2 gdg+2 tgl) = 2 + 18 = 20 param
  const params = [
    gdgLike,
    startDate, // StokAwal
    gdgLike,
    startDate,
    endDate, // BpbBahan
    gdgLike,
    startDate,
    endDate, // ReturMaterial
    gdgLike,
    startDate,
    endDate, // MutasiMasuk
    gdgLike,
    startDate,
    endDate, // Koreksi
    gdgLike,
    startDate,
    endDate, // PermintaanMaterial
    gdgLike,
    startDate,
    endDate, // MutasiKeluar  ← ini yang kelewat sebelumnya
  ];

  const [rows] = await db.query(sql, params);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per satu kode bahan, difilter gudang + periode.
// ─────────────────────────────────────────────
const getDetail = async (kode, startDate, endDate, gudang = "") => {
  const gdgLike = `%${gudang}%`;

  const [awalRows] = await db.query(
    `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS awal
     FROM tmasterstok_bahan
     WHERE mst_aktif = 'Y' AND mst_gdg_kode LIKE ?
       AND mst_tanggal < ? AND mst_brg_kode = ?`,
    [gdgLike, startDate, kode],
  );
  const stokAwal = Number(awalRows[0]?.awal) || 0;

  const [trxRows] = await db.query(
    `SELECT
       m.mst_noreferensi AS Nomor,
       DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d') AS Tanggal,
       m.mst_stok_in  AS StokIn,
       m.mst_stok_out AS StokOut,
       IF(LEFT(m.mst_noreferensi,3)='PBG','BPB Bahan',
         IF(LEFT(m.mst_noreferensi,4)='RETP','Retur Material',
           IF(LEFT(m.mst_noreferensi,3)='BBM','Mutasi Masuk',
             IF(LEFT(m.mst_noreferensi,3)='KOR','Koreksi',
               IF(LEFT(m.mst_noreferensi,4)='PROG','Permintaan Material',
                 IF(LEFT(m.mst_noreferensi,3)='BBK','Mutasi Keluar','')
               )
             )
           )
         )
       ) AS Transaksi
     FROM tmasterstok_bahan m
     WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode LIKE ?
       AND m.mst_brg_kode = ?
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
// ALL DETAIL — untuk tombol "Export Detail" (semua bahan sesuai
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
