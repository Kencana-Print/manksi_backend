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
    -- 1. Gunakan CTE untuk memfilter data utama terlebih dahulu
    WITH base_orders AS (
      SELECT
        1 AS SourceOrder, s.date_create AS DateCreate,
        s.spk_nomor AS Nomor, s.spk_tanggal AS Tanggal, s.spk_dateline AS Dateline,
        s.spk_divisi AS Divisi, s.spk_tipe AS Tipe, s.spk_cab AS Cab,
        s.spk_statuskerja AS Kepentingan, s.spk_cus_kode AS KdCus,
        s.spk_nama AS NamaSPK, s.spk_jumlah AS JumlahSPK, s.spk_kain AS Kain,
        s.spk_finishing AS Finishing, s.spk_sablon AS Sablon, s.spk_sublim AS Sublim,
        s.spk_bordir AS Bordir,
        s.spk_so_ref AS RefNomor
      FROM tspk s
      WHERE s.spk_cmo <> '' AND s.spk_aktif = 'Y' AND s.spk_divisi IN (3, 4, 6)
        AND s.spk_jo_kode NOT IN ('', 'SD', 'BR', 'PL', 'SB', 'KS', 'DP', 'TG')
        -- [PERBAIKAN 1]: SARGABLE Date Filter (Hapus fungsi DATE() yang mematikan Indeks)
        AND s.spk_tanggal >= CONCAT(?, ' 00:00:00') 
        AND s.spk_tanggal <= CONCAT(?, ' 23:59:59')

      UNION ALL

      SELECT
        1 AS SourceOrder, s.date_create AS DateCreate,
        s.so_nomor AS Nomor, s.so_tanggal AS Tanggal, s.so_dateline AS Dateline,
        s.so_divisi AS Divisi, s.so_tipe AS Tipe, s.so_cab AS Cab,
        s.so_statuskerja AS Kepentingan, s.so_cus_kode AS KdCus,
        s.so_nama AS NamaSPK, s.so_jumlah AS JumlahSPK, s.so_kain AS Kain,
        s.so_finishing AS Finishing, s.so_sablon AS Sablon, s.so_sublim AS Sublim,
        s.so_bordir AS Bordir,
        NULL AS RefNomor
      FROM tsalesorder s
      WHERE s.so_cmo <> '' AND s.so_aktif = 'Y' AND s.so_divisi IN (3, 4, 6)
        AND s.so_jo_kode NOT IN ('', 'SD', 'BR', 'PL', 'SB', 'KS', 'DP', 'TG')
        AND s.so_tanggal >= CONCAT(?, ' 00:00:00') 
        AND s.so_tanggal <= CONCAT(?, ' 23:59:59')
        AND NOT EXISTS (
          SELECT 1 FROM tspk ppic
          WHERE ppic.spk_so_ref = s.so_nomor AND ppic.spk_is_so = 0
        )

      UNION ALL

      SELECT
        2 AS SourceOrder, s.date_create AS DateCreate,
        s.mspk_nomor AS Nomor, s.mspk_tanggal AS Tanggal, s.mspk_dateline AS Dateline,
        s.mspk_divisi AS Divisi, s.mspk_tipe AS Tipe, s.mspk_cab AS Cab,
        s.mspk_statuskerja AS Kepentingan, s.mspk_cus_kode AS KdCus,
        s.mspk_nama AS NamaSPK, s.mspk_jumlah AS JumlahSPK, s.mspk_kain AS Kain,
        s.mspk_finishing AS Finishing, s.mspk_sablon AS Sablon, s.mspk_sublim AS Sublim,
        s.mspk_bordir AS Bordir,
        NULL AS RefNomor
      FROM tmemospk s
      WHERE s.mspk_cmo <> '' AND s.mspk_aktif = 'Y' AND s.mspk_divisi IN (3, 4, 6)
        AND s.mspk_jo_kode NOT IN ('', 'SD', 'BR', 'PL', 'SB', 'KS', 'DP', 'TG')
        AND s.mspk_tanggal >= CONCAT(?, ' 00:00:00') 
        AND s.mspk_tanggal <= CONCAT(?, ' 23:59:59')
    )
    
    SELECT 
      x.Nomor, x.Tanggal, x.Dateline, x.Divisi, x.Tipe, x.Cab, x.Kepentingan,
      x.KdCus, x.NamaSPK, x.JumlahSPK, x.Kain, x.Finishing, x.Sablon, x.Sublim,
      x.Bordir,
      
      -- [PERBAIKAN 2]: Hindari COUNT() > 0 pada seluruh tabel, gunakan EXISTS yang otomatis berhenti di baris pertama
      IF(EXISTS(SELECT 1 FROM tproduksiminta_hdr r WHERE r.promin_spk_nomor = x.Nomor), 'SUDAH', 'BELUM') AS RPB,
      
      -- [PERBAIKAN 3]: Hindari 7 Subquery terpisah untuk setiap baris, gabungkan ke dalam 1x kalkulasi dari tabel JOIN di bawah
      IF(IFNULL(SUM(p.plan_datang), 0) = 0, 1,
        IF(IFNULL(SUM(p.plan_cutting), 0) = 0, 2,
          IF(IFNULL(SUM(p.plan_cetak + p.plan_sublim), 0) = 0, 3,
            IF(IFNULL(SUM(p.plan_bordir), 0) = 0, 4,
              IF(IFNULL(SUM(p.plan_jahit), 0) = 0, 5,
                IF(IFNULL(SUM(p.plan_finishing), 0) = 0, 6,
                  IF(IFNULL(SUM(p.plan_kirim), 0) = 0, 7, 0)
                )
              )
            )
          )
        )
      ) AS Belum

    FROM base_orders x
    -- Lakukan Join hanya pada kumpulan SPK yang sudah difilter (sangat sedikit)
    LEFT JOIN tplanningspk p ON (p.plan_spk = x.Nomor OR p.plan_spk = x.RefNomor)
    
    -- Kelompokkan kembali setelah proses agregasi (SUM) 
    GROUP BY 
      x.SourceOrder, x.DateCreate, x.Nomor, x.Tanggal, x.Dateline, x.Divisi, x.Tipe, x.Cab, x.Kepentingan,
      x.KdCus, x.NamaSPK, x.JumlahSPK, x.Kain, x.Finishing, x.Sablon, x.Sublim, x.Bordir, x.RefNomor
      
    ORDER BY 
      x.SourceOrder ASC, x.DateCreate ASC
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
