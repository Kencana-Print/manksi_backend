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
    SELECT
      x.Nomor, x.Tanggal, x.Dateline, x.Divisi, x.Tipe, x.Cab, x.Kepentingan,
      x.KdCus, x.NamaSPK, x.JumlahSPK, x.Kain, x.Finishing, x.Sablon, x.Sublim,
      x.Bordir, x.RPB,
      IF(x.datang = 0, 1,
        IF(x.cutting = 0, 2,
          IF(x.cetak = 0, 3,
            IF(x.qbordir = 0, 4,
              IF(x.jahit = 0, 5,
                IF(x.qfinishing = 0, 6,
                  IF(x.kirim = 0, 7, 0)
                )
              )
            )
          )
        )
      ) AS Belum
    FROM (
      -- Sumber 1: tspk (SPK garmen) — SourceOrder=1
      SELECT
        1 AS SourceOrder, s.date_create AS DateCreate,
        s.spk_nomor AS Nomor, s.spk_tanggal AS Tanggal, s.spk_dateline AS Dateline,
        s.spk_divisi AS Divisi, s.spk_tipe AS Tipe, s.spk_cab AS Cab,
        s.spk_statuskerja AS Kepentingan, s.spk_cus_kode AS KdCus,
        s.spk_nama AS NamaSPK, s.spk_jumlah AS JumlahSPK, s.spk_kain AS Kain,
        s.spk_finishing AS Finishing, s.spk_sablon AS Sablon, s.spk_sublim AS Sublim,
        s.spk_bordir AS Bordir,
        -- ⚠️ FIX: planning kedatangan bahan bisa tersimpan atas nomor SO
        -- induknya (kalau MKB dibuat mereferensikan SO, bukan SPK PPIC
        -- turunannya) — cocokkan ke keduanya, bukan cuma spk_nomor sendiri.
        (SELECT IFNULL(SUM(p.plan_datang), 0) FROM tplanningspk p WHERE p.plan_spk IN (s.spk_nomor, s.spk_so_ref)) AS datang,
        (SELECT IFNULL(SUM(p.plan_cutting), 0) FROM tplanningspk p WHERE p.plan_spk IN (s.spk_nomor, s.spk_so_ref)) AS cutting,
        (SELECT IFNULL(SUM(p.plan_cetak + p.plan_sublim), 0) FROM tplanningspk p WHERE p.plan_spk IN (s.spk_nomor, s.spk_so_ref)) AS cetak,
        (SELECT IFNULL(SUM(p.plan_bordir), 0) FROM tplanningspk p WHERE p.plan_spk IN (s.spk_nomor, s.spk_so_ref)) AS qbordir,
        (SELECT IFNULL(SUM(p.plan_jahit), 0) FROM tplanningspk p WHERE p.plan_spk IN (s.spk_nomor, s.spk_so_ref)) AS jahit,
        (SELECT IFNULL(SUM(p.plan_finishing), 0) FROM tplanningspk p WHERE p.plan_spk IN (s.spk_nomor, s.spk_so_ref)) AS qfinishing,
        (SELECT IFNULL(SUM(p.plan_kirim), 0) FROM tplanningspk p WHERE p.plan_spk IN (s.spk_nomor, s.spk_so_ref)) AS kirim,
        IFNULL((SELECT IF(COUNT(r.promin_spk_nomor) > 0, "SUDAH", "BELUM")
                FROM tproduksiminta_hdr r WHERE r.promin_spk_nomor = s.spk_nomor), 0) AS RPB
      FROM tspk s
      WHERE s.spk_cmo <> "" AND s.spk_aktif = "Y" AND s.spk_divisi IN (3, 4, 6)
        AND s.spk_jo_kode NOT IN ("", "SD", "BR", "PL", "SB", "KS", "DP", "TG")
        AND DATE(s.spk_tanggal) BETWEEN ? AND ?

      UNION ALL

      -- ⚠️ Sumber baru — tsalesorder (SO baru pasca migrasi). MKB
      -- sekarang bisa mereferensikan nomor SO langsung, jadi modul
      -- ini perlu ikut menampilkan & memantau planning-nya. SourceOrder
      -- disamakan dengan tspk (=1) supaya SO tercampur berdasar tanggal
      -- dengan SPK, bukan selalu di bawah blok MAP.
      SELECT
        1 AS SourceOrder, s.date_create AS DateCreate,
        s.so_nomor AS Nomor, s.so_tanggal AS Tanggal, s.so_dateline AS Dateline,
        s.so_divisi AS Divisi, s.so_tipe AS Tipe, s.so_cab AS Cab,
        s.so_statuskerja AS Kepentingan, s.so_cus_kode AS KdCus,
        s.so_nama AS NamaSPK, s.so_jumlah AS JumlahSPK, s.so_kain AS Kain,
        s.so_finishing AS Finishing, s.so_sablon AS Sablon, s.so_sublim AS Sublim,
        s.so_bordir AS Bordir,
        (SELECT IFNULL(SUM(p.plan_datang), 0) FROM tplanningspk p WHERE p.plan_spk = s.so_nomor) AS datang,
        (SELECT IFNULL(SUM(p.plan_cutting), 0) FROM tplanningspk p WHERE p.plan_spk = s.so_nomor) AS cutting,
        (SELECT IFNULL(SUM(p.plan_cetak + p.plan_sublim), 0) FROM tplanningspk p WHERE p.plan_spk = s.so_nomor) AS cetak,
        (SELECT IFNULL(SUM(p.plan_bordir), 0) FROM tplanningspk p WHERE p.plan_spk = s.so_nomor) AS qbordir,
        (SELECT IFNULL(SUM(p.plan_jahit), 0) FROM tplanningspk p WHERE p.plan_spk = s.so_nomor) AS jahit,
        (SELECT IFNULL(SUM(p.plan_finishing), 0) FROM tplanningspk p WHERE p.plan_spk = s.so_nomor) AS qfinishing,
        (SELECT IFNULL(SUM(p.plan_kirim), 0) FROM tplanningspk p WHERE p.plan_spk = s.so_nomor) AS kirim,
        IFNULL((SELECT IF(COUNT(r.promin_spk_nomor) > 0, "SUDAH", "BELUM")
                FROM tproduksiminta_hdr r WHERE r.promin_spk_nomor = s.so_nomor), 0) AS RPB
      FROM tsalesorder s
      WHERE s.so_cmo <> "" AND s.so_aktif = "Y" AND s.so_divisi IN (3, 4, 6)
        AND s.so_jo_kode NOT IN ("", "SD", "BR", "PL", "SB", "KS", "DP", "TG")
        AND DATE(s.so_tanggal) BETWEEN ? AND ?
        -- ⚠️ Jangan tampilkan baris SO kalau sudah ada SPK PPIC turunannya —
        -- planning-nya sudah terwakili di baris SPK PPIC (lihat fix di atas),
        -- kalau tidak difilter, user akan lihat 2 baris untuk 1 order yang sama.
        AND NOT EXISTS (
          SELECT 1 FROM tspk ppic
          WHERE ppic.spk_so_ref = s.so_nomor AND ppic.spk_is_so = 0
        )

      UNION ALL

      -- Sumber 3 (dulu 2): tmemospk (MAP) — SourceOrder=2, selalu paling bawah
      SELECT
        2 AS SourceOrder, s.date_create AS DateCreate,
        s.mspk_nomor AS Nomor, s.mspk_tanggal AS Tanggal, s.mspk_dateline AS Dateline,
        s.mspk_divisi AS Divisi, s.mspk_tipe AS Tipe, s.mspk_cab AS Cab,
        s.mspk_statuskerja AS Kepentingan, s.mspk_cus_kode AS KdCus,
        s.mspk_nama AS NamaSPK, s.mspk_jumlah AS JumlahSPK, s.mspk_kain AS Kain,
        s.mspk_finishing AS Finishing, s.mspk_sablon AS Sablon, s.mspk_sublim AS Sublim,
        s.mspk_bordir AS Bordir,
        (SELECT IFNULL(SUM(p.plan_datang), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS datang,
        (SELECT IFNULL(SUM(p.plan_cutting), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS cutting,
        (SELECT IFNULL(SUM(p.plan_cetak + p.plan_sublim), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS cetak,
        (SELECT IFNULL(SUM(p.plan_bordir), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS qbordir,
        (SELECT IFNULL(SUM(p.plan_jahit), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS jahit,
        (SELECT IFNULL(SUM(p.plan_finishing), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS qfinishing,
        (SELECT IFNULL(SUM(p.plan_kirim), 0) FROM tplanningspk p WHERE p.plan_spk = s.mspk_nomor) AS kirim,
        IFNULL((SELECT IF(COUNT(r.promin_spk_nomor) > 0, "SUDAH", "BELUM")
                FROM tproduksiminta_hdr r WHERE r.promin_spk_nomor = s.mspk_nomor), 0) AS RPB
      FROM tmemospk s
      WHERE s.mspk_cmo <> "" AND s.mspk_aktif = "Y" AND s.mspk_divisi IN (3, 4, 6)
        AND s.mspk_jo_kode NOT IN ("", "SD", "BR", "PL", "SB", "KS", "DP", "TG")
        AND DATE(s.mspk_tanggal) BETWEEN ? AND ?
    ) x
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
