const db = require("../../config/database");

const getBrowseList = async (query) => {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .substring(0, 10);
  const defaultEnd = today.toISOString().substring(0, 10);

  const startDate = query.startDate || defaultStart;
  const endDate = query.endDate || defaultEnd;

  const sql = `
    WITH base_orders AS (
      SELECT
        1 AS SourceOrder, s.date_create AS DateCreate,
        s.spk_nomor AS Nomor,
        DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
        DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Dateline,
        s.spk_divisi AS Divisi, s.spk_tipe AS Tipe, s.spk_cab AS Cab,
        s.spk_statuskerja AS Kepentingan, s.spk_cus_kode AS KdCus,
        s.spk_nama AS NamaSPK, s.spk_jumlah AS JumlahSPK, s.spk_kain AS Kain,
        s.spk_finishing AS Finishing, s.spk_sablon AS Sablon, s.spk_sublim AS Sublim,
        s.spk_bordir AS Bordir,
        s.spk_so_ref AS RefNomor
      FROM tspk s
      WHERE s.spk_aktif = 'Y' AND s.spk_divisi IN (3, 4, 6)
        AND s.spk_cmo <> ''
        AND s.spk_jo_kode NOT IN ('', 'SD', 'BR', 'PL', 'SB', 'KS', 'DP', 'TG')
        AND s.spk_tanggal >= CONCAT(?, ' 00:00:00')
        AND s.spk_tanggal <= CONCAT(?, ' 23:59:59')

      UNION ALL

      SELECT
        1 AS SourceOrder, s.date_create AS DateCreate,
        s.so_nomor AS Nomor,
        DATE_FORMAT(s.so_tanggal, '%Y-%m-%d') AS Tanggal,
        DATE_FORMAT(s.so_dateline, '%Y-%m-%d') AS Dateline,
        s.so_divisi AS Divisi, s.so_tipe AS Tipe, s.so_cab AS Cab,
        s.so_statuskerja AS Kepentingan, s.so_cus_kode AS KdCus,
        s.so_nama AS NamaSPK, s.so_jumlah AS JumlahSPK, s.so_kain AS Kain,
        s.so_finishing AS Finishing, s.so_sablon AS Sablon, s.so_sublim AS Sublim,
        s.so_bordir AS Bordir,
        NULL AS RefNomor
      FROM tsalesorder s
      LEFT JOIN tspk ppic
        ON ppic.spk_so_ref = s.so_nomor AND ppic.spk_is_so = 0
      WHERE s.so_aktif = 'Y' AND s.so_divisi IN (3, 4, 6)
        AND s.so_cmo <> ''
        AND s.so_jo_kode NOT IN ('', 'SD', 'BR', 'PL', 'SB', 'KS', 'DP', 'TG')
        AND s.so_tanggal >= CONCAT(?, ' 00:00:00')
        AND s.so_tanggal <= CONCAT(?, ' 23:59:59')
        AND ppic.spk_nomor IS NULL

      UNION ALL

      SELECT
        2 AS SourceOrder, s.date_create AS DateCreate,
        s.mspk_nomor AS Nomor,
        DATE_FORMAT(s.mspk_tanggal, '%Y-%m-%d') AS Tanggal,
        DATE_FORMAT(s.mspk_dateline, '%Y-%m-%d') AS Dateline,
        s.mspk_divisi AS Divisi, s.mspk_tipe AS Tipe, s.mspk_cab AS Cab,
        s.mspk_statuskerja AS Kepentingan, s.mspk_cus_kode AS KdCus,
        s.mspk_nama AS NamaSPK, s.mspk_jumlah AS JumlahSPK, s.mspk_kain AS Kain,
        s.mspk_finishing AS Finishing, s.mspk_sablon AS Sablon, s.mspk_sublim AS Sublim,
        s.mspk_bordir AS Bordir,
        NULL AS RefNomor
      FROM tmemospk s
      WHERE s.mspk_aktif = 'Y' AND s.mspk_divisi IN (3, 4, 6)
        AND s.mspk_cmo <> ''
        AND s.mspk_jo_kode NOT IN ('', 'SD', 'BR', 'PL', 'SB', 'KS', 'DP', 'TG')
        AND s.mspk_tanggal >= CONCAT(?, ' 00:00:00')
        AND s.mspk_tanggal <= CONCAT(?, ' 23:59:59')
    ),

    -- [FIX] Agregasi tplanningspk PER plan_spk dulu (SUM semua tanggal),
    -- baru di-JOIN. plan_spk BUKAN unik sendirian -- satu SPK bisa
    -- punya banyak baris planning (satu per tanggal), jadi JOIN
    -- langsung ke tabel mentah bikin baris SPK ke-multiply setiap
    -- SPK punya >1 baris planning (persis abis user input planning).
    plan_agg AS (
      SELECT
        plan_spk,
        SUM(plan_datang) AS plan_datang,
        SUM(plan_cutting) AS plan_cutting,
        SUM(plan_cetak) AS plan_cetak,
        SUM(plan_sublim) AS plan_sublim,
        SUM(plan_bordir) AS plan_bordir,
        SUM(plan_jahit) AS plan_jahit,
        SUM(plan_finishing) AS plan_finishing,
        SUM(plan_kirim) AS plan_kirim
      FROM tplanningspk
      GROUP BY plan_spk
    )

    SELECT
      x.Nomor, x.Tanggal, x.Dateline, x.Divisi, x.Tipe, x.Cab, x.Kepentingan,
      x.KdCus, x.NamaSPK, x.JumlahSPK, x.Kain, x.Finishing, x.Sablon, x.Sublim,
      x.Bordir,

      IF(rpb.promin_spk_nomor IS NULL, 'BELUM', 'SUDAH') AS RPB,

      IF(IFNULL(p1.plan_datang, 0) + IFNULL(p2.plan_datang, 0) = 0, 1,
        IF(IFNULL(p1.plan_cutting, 0) + IFNULL(p2.plan_cutting, 0) = 0, 2,
          IF(IFNULL(p1.plan_cetak, 0) + IFNULL(p2.plan_cetak, 0)
             + IFNULL(p1.plan_sublim, 0) + IFNULL(p2.plan_sublim, 0) = 0, 3,
            IF(IFNULL(p1.plan_bordir, 0) + IFNULL(p2.plan_bordir, 0) = 0, 4,
              IF(IFNULL(p1.plan_jahit, 0) + IFNULL(p2.plan_jahit, 0) = 0, 5,
                IF(IFNULL(p1.plan_finishing, 0) + IFNULL(p2.plan_finishing, 0) = 0, 6,
                  IF(IFNULL(p1.plan_kirim, 0) + IFNULL(p2.plan_kirim, 0) = 0, 7, 0)
                )
              )
            )
          )
        )
      ) AS Belum

    FROM base_orders x
    LEFT JOIN plan_agg p1 ON p1.plan_spk = x.Nomor
    LEFT JOIN plan_agg p2 ON p2.plan_spk = x.RefNomor
    LEFT JOIN (
      SELECT DISTINCT promin_spk_nomor FROM tproduksiminta_hdr
    ) rpb ON rpb.promin_spk_nomor = x.Nomor

    ORDER BY x.SourceOrder ASC, x.DateCreate ASC
  `;

  const [rows] = await db.query(sql, [
    startDate,
    endDate,
    startDate,
    endDate,
    startDate,
    endDate,
  ]);

  return rows.map((r) => ({
    ...r,
    JumlahSPK: Number(r.JumlahSPK) || 0,
    Belum: Number(r.Belum) || 0,
  }));
};

const getDetailByNomor = async (nomor) => {
  // ⚠️ Sama akar masalah dengan getBrowseList: planning "Bahan Datang"
  // bisa tersimpan atas nomor SO induk (kalau MKB dibuat mereferensikan
  // SO, bukan SPK PPIC turunannya) — bukan cuma atas nomor sendiri.
  // Resolve dulu spk_so_ref-nya, baru query ke kedua kemungkinan key.
  const [[spkRow]] = await db.query(
    `SELECT spk_so_ref FROM tspk WHERE spk_nomor = ?`,
    [nomor],
  );
  const soRef = spkRow?.spk_so_ref || "";

  const planKeys = soRef ? [nomor, soRef] : [nomor];

  const [rows] = await db.query(
    `SELECT
       p.plan_spk AS Nomor,
       p.plan_tanggal AS TglEstimasi,
       p.plan_datang AS KedatanganBahan,
       p.plan_cutting AS Cutting,
       p.plan_cetak AS Cetak,
       p.plan_sublim AS Sublim,
       p.plan_bordir AS Bordir,
       p.plan_jahit AS Jahit,
       p.plan_finishing AS Finishing,
       p.plan_kirim AS Kirim
     FROM tplanningspk p
     WHERE p.plan_spk IN (?)
     ORDER BY p.plan_tanggal`,
    [planKeys],
  );
  return rows;
};

module.exports = { getBrowseList, getDetailByNomor };
