const db = require("../../../config/database");

// ── Master Rekonsiliasi ───────────────────────────────────────────────
// Delphi btnRefreshClick — query persis sama, nested subquery
// Kolom computed di outer query:
//   Bank    = saldobank + tambah_ - kurang_
//   Buku    = saldobuku + tambah  - kurang
//   Selisih = Bank - Buku
const getMaster = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       x.Tanggal,
       x.Account,
       x.Nama,
       x.SaldoBuku,
       x.Tambah,
       x.Kurang,
       x.SaldoBank,
       x.Tambah_,
       x.Kurang_,
       (x.SaldoBank  + x.Tambah_ - x.Kurang_) AS Bank,
       (x.SaldoBuku  + x.Tambah  - x.Kurang)  AS Buku,
       ((x.SaldoBank + x.Tambah_ - x.Kurang_)
        - (x.SaldoBuku + x.Tambah - x.Kurang)) AS Selisih
     FROM (
       SELECT
         DATE_FORMAT(v.rkv_tanggal, '%Y-%m-%d')     AS Tanggal,
         v.rkv_rek_kode                              AS Account,
         r.rek_nama                                  AS Nama,
         v.rkv_saldo                                 AS SaldoBuku,
         IFNULL(SUM(a.rk_nominal), 0)               AS Tambah,
         IFNULL(SUM(c.rk_nominal), 0)               AS Kurang,
         v.rkv_koran                                 AS SaldoBank,
         IFNULL(SUM(b.rk_nominal), 0)               AS Tambah_,
         IFNULL(SUM(d.rk_nominal), 0)               AS Kurang_
       FROM finance.trekon_valid v
       LEFT JOIN finance.trekening r
              ON r.rek_kode = v.rkv_rek_kode
       LEFT JOIN finance.trekon_det a
              ON a.rk_rek_kode = v.rkv_rek_kode
             AND a.rk_tanggal  = v.rkv_tanggal
       LEFT JOIN finance.trekon_det3 c
              ON c.rk_rek_kode = v.rkv_rek_kode
             AND c.rk_tanggal  = v.rkv_tanggal
       LEFT JOIN finance.trekon_det2 b
              ON b.rk_rek_kode = v.rkv_rek_kode
             AND b.rk_tanggal  = v.rkv_tanggal
       LEFT JOIN finance.trekon_det4 d
              ON d.rk_rek_kode = v.rkv_rek_kode
             AND d.rk_tanggal  = v.rkv_tanggal
       WHERE v.rkv_tanggal BETWEEN ? AND ?
       GROUP BY v.rkv_rek_kode, v.rkv_tanggal
     ) x
     ORDER BY x.Tanggal, x.Account`,
    [startDate, endDate],
  );
  return rows;
};

// ── Detail per Account+Tanggal ────────────────────────────────────────
// Tidak ada di Delphi tapi tombol Export Detail ada — ambil semua
// item dari 4 tabel det untuk rekening+tanggal tertentu
// Jenis: det=TambahBuku, det2=TambahBank, det3=KurangBuku, det4=KurangBank
const getDetail = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       DATE_FORMAT(v.rkv_tanggal, '%Y-%m-%d') AS Tanggal,
       v.rkv_rek_kode                         AS Account,
       r.rek_nama                             AS Nama,
       'Tambah Buku'                          AS Jenis,
       IFNULL(a.rk_nama, '')                  AS Nomor,
       IFNULL(a.rk_ket, '')                   AS Keterangan,
       a.rk_nominal                           AS Nominal
     FROM finance.trekon_valid v
     LEFT JOIN finance.trekening r ON r.rek_kode = v.rkv_rek_kode
     INNER JOIN finance.trekon_det a
            ON a.rk_rek_kode = v.rkv_rek_kode
           AND a.rk_tanggal  = v.rkv_tanggal
     WHERE v.rkv_tanggal BETWEEN ? AND ?

     UNION ALL

     SELECT
       DATE_FORMAT(v.rkv_tanggal, '%Y-%m-%d') AS Tanggal,
       v.rkv_rek_kode                         AS Account,
       r.rek_nama                             AS Nama,
       'Tambah Bank'                          AS Jenis,
       IFNULL(b.rk_nama, '')                  AS Nomor,
       IFNULL(b.rk_ket, '')                   AS Keterangan,
       b.rk_nominal                           AS Nominal
     FROM finance.trekon_valid v
     LEFT JOIN finance.trekening r ON r.rek_kode = v.rkv_rek_kode
     INNER JOIN finance.trekon_det2 b
            ON b.rk_rek_kode = v.rkv_rek_kode
           AND b.rk_tanggal  = v.rkv_tanggal
     WHERE v.rkv_tanggal BETWEEN ? AND ?

     UNION ALL

     SELECT
       DATE_FORMAT(v.rkv_tanggal, '%Y-%m-%d') AS Tanggal,
       v.rkv_rek_kode                         AS Account,
       r.rek_nama                             AS Nama,
       'Kurang Buku'                          AS Jenis,
       IFNULL(c.rk_nama, '')                  AS Nomor,
       IFNULL(c.rk_ket, '')                   AS Keterangan,
       c.rk_nominal                           AS Nominal
     FROM finance.trekon_valid v
     LEFT JOIN finance.trekening r ON r.rek_kode = v.rkv_rek_kode
     INNER JOIN finance.trekon_det3 c
            ON c.rk_rek_kode = v.rkv_rek_kode
           AND c.rk_tanggal  = v.rkv_tanggal
     WHERE v.rkv_tanggal BETWEEN ? AND ?

     UNION ALL

     SELECT
       DATE_FORMAT(v.rkv_tanggal, '%Y-%m-%d') AS Tanggal,
       v.rkv_rek_kode                         AS Account,
       r.rek_nama                             AS Nama,
       'Kurang Bank'                          AS Jenis,
       IFNULL(d.rk_nama, '')                  AS Nomor,
       IFNULL(d.rk_ket, '')                   AS Keterangan,
       d.rk_nominal                           AS Nominal
     FROM finance.trekon_valid v
     LEFT JOIN finance.trekening r ON r.rek_kode = v.rkv_rek_kode
     INNER JOIN finance.trekon_det4 d
            ON d.rk_rek_kode = v.rkv_rek_kode
           AND d.rk_tanggal  = v.rkv_tanggal
     WHERE v.rkv_tanggal BETWEEN ? AND ?

     ORDER BY Tanggal, Account, Jenis, Nomor`,
    [
      startDate,
      endDate,
      startDate,
      endDate,
      startDate,
      endDate,
      startDate,
      endDate,
    ],
  );
  return rows;
};

const getRekonsiliasi = async (startDate, endDate) => {
  const [master, detail] = await Promise.all([
    getMaster(startDate, endDate),
    getDetail(startDate, endDate),
  ]);
  return { master, detail };
};

module.exports = { getMaster, getDetail, getRekonsiliasi };
