const db = require("../../../config/database");

// ─────────────────────────────────────────────
// HELPER: filter dasar tbahan (kode kosong = semua)
// ─────────────────────────────────────────────
const buildWhereBahan = (kodeBahan) => {
  let where = `WHERE b.bhn_aktif = 0 AND b.bhn_jb_kode <> 'LL'`;
  const params = [];
  if (kodeBahan) {
    where += ` AND b.bhn_kode = ?`;
    params.push(kodeBahan);
  }
  return { where, params };
};

// ─────────────────────────────────────────────
// MASTER — replikasi persis query Delphi btnRefreshClick.
// CATATAN: StokAkhir TIDAK memasukkan ReturBeli — ini sesuai
// rumus asli Delphi (StokAwal+BPB_Bahan+ReturMaterial+Koreksi)
// - RealisasiPermintaan, bukan kesalahan replikasi.
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate, kodeBahan = "") => {
  const { where, params } = buildWhereBahan(kodeBahan);

  const sql = `
    SELECT x.*,
      ((x.StokAwal + x.BpbBahan + x.ReturMaterial + x.Koreksi) - x.RealisasiPermintaan) AS StokAkhir
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
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
            AND m.mst_tanggal < ? AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS StokAwal,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'PBG' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS BpbBahan,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 4) = 'RETP' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS ReturMaterial,
        IFNULL((
          SELECT SUM(m.mst_stok_in)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'KOR' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS Koreksi,
        IFNULL((
          SELECT SUM(m.mst_stok_out)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 4) = 'PROG' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS RealisasiPermintaan,
        IFNULL((
          SELECT SUM(m.mst_stok_out)
          FROM tmasterstok_bahan m
          WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
            AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
            AND LEFT(m.mst_noreferensi, 3) = 'RBB' AND m.mst_brg_kode = b.bhn_kode
        ), 0) AS ReturBeli
      FROM tbahan b
      ${where}
    ) x
    ORDER BY x.Kode
  `;

  // Urutan param: 1 (StokAwal) + 2x5 (kelima subquery periode) = 11,
  // baru diikuti param WHERE tbahan (kodeBahan jika ada)
  const dateParams = [
    startDate,
    startDate,
    endDate,
    startDate,
    endDate,
    startDate,
    endDate,
    startDate,
    endDate,
    startDate,
    endDate,
  ];

  const [rows] = await db.query(sql, [...dateParams, ...params]);
  return rows;
};

// ─────────────────────────────────────────────
// DETAIL — per satu kode bahan. Baris pertama "Stok Awal"
// (sintetis, sama seperti insert manual di Delphi), lalu daftar
// transaksi mentah dalam periode dengan label Transaksi turunan
// dari prefix mst_noreferensi.
// ─────────────────────────────────────────────
const getDetail = async (kode, startDate, endDate) => {
  const [awalRows] = await db.query(
    `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS awal
     FROM tmasterstok_bahan
     WHERE mst_aktif = 'Y' AND mst_gdg_kode = 'GB001'
       AND mst_tanggal < ? AND mst_brg_kode = ?`,
    [startDate, kode],
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
           IF(LEFT(m.mst_noreferensi,3)='KOR','Koreksi',
             IF(LEFT(m.mst_noreferensi,3)='RBB','Retur Beli',
               IF(LEFT(m.mst_noreferensi,4)='PROG','Realisasi Permintaan','')
             )
           )
         )
       ) AS Transaksi
     FROM tmasterstok_bahan m
     WHERE m.mst_aktif = 'Y' AND m.mst_gdg_kode = 'GB001'
       AND m.mst_brg_kode = ?
       AND m.mst_tanggal >= ? AND m.mst_tanggal <= ?
     ORDER BY m.mst_tanggal`,
    [kode, startDate, endDate],
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
// filter, digabung jadi satu daftar flat dengan kolom Kode/Nama).
// ─────────────────────────────────────────────
const getAllDetail = async (startDate, endDate, kodeBahan = "") => {
  const { where, params } = buildWhereBahan(kodeBahan);
  const [bahanRows] = await db.query(
    `SELECT b.bhn_kode AS Kode, b.bhn_name AS Nama
     FROM tbahan b ${where}
     ORDER BY b.bhn_kode`,
    params,
  );

  const result = [];
  for (const b of bahanRows) {
    const dtl = await getDetail(b.Kode, startDate, endDate);
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
