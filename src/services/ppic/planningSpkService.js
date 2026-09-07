// services/ppic/planningSpkService.js
const db = require("../../config/database");

// ─────────────────────────────────────────────
// Generate nomor
// ─────────────────────────────────────────────
const generateNomor = async (tahun) => {
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(pl_nomor, 9, 5) AS UNSIGNED)), 0) AS jumlah
     FROM tplan_ppic_hdr
     WHERE LEFT(pl_nomor, 7) = 'PL/PPIC'
       AND RIGHT(pl_nomor, 4) = ?`,
    [String(tahun)],
  );
  return `PL/PPIC/${String(rows[0].jumlah + 1).padStart(5, "0")}/${tahun}`;
};

// ─────────────────────────────────────────────
// getBrowse — master list
// ─────────────────────────────────────────────
const getBrowse = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       h.pl_nomor      AS Nomor,
       DATE_FORMAT(h.pl_tgl1, '%Y-%m-%d') AS TglAwal,
       DATE_FORMAT(h.pl_tgl2, '%Y-%m-%d') AS TglAkhir,
       h.pl_cab        AS Cabang,
       h.pl_close      AS Close,
       h.pl_keterangan AS Keterangan,
       COUNT(DISTINCT d.plan_spk) AS JumlahSPK
     FROM tplan_ppic_hdr h
     LEFT JOIN tplan_ppic_dtl2 d ON d.plan_pl_nomor = h.pl_nomor
     WHERE h.pl_tgl1 BETWEEN ? AND ?
     GROUP BY h.pl_nomor, h.pl_tgl1, h.pl_tgl2,
              h.pl_cab, h.pl_close, h.pl_keterangan
     ORDER BY h.pl_nomor ASC`,
    [startDate, endDate],
  );
  return rows;
};

// ─────────────────────────────────────────────
// getDetail — expand per nomor, per divisi
// ─────────────────────────────────────────────
const getDetail = async (nomor) => {
  // Helper loadDivisi — query per divisi dengan JOIN tspk
  const loadDivisi = async (divisi) => {
    const [rows] = await db.query(
      `SELECT
         d.plan_spk             AS NomorSPK,
         s.spk_nama             AS NamaSPK,
         DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d') AS TglJadwal,
         d.plan_wip             AS Wip,
         d.plan_qty_po          AS QtyPo,
         d.plan_qty_jadwal      AS QtyJadwal,
         d.plan_line_kelompok   AS LineKelompok
       FROM tplan_ppic_dtl2 d
       LEFT JOIN tspk s ON s.spk_nomor = d.plan_spk
       WHERE d.plan_pl_nomor = ? AND d.plan_divisi = ?
       ORDER BY d.plan_tgl_jadwal ASC`,
      [nomor, divisi],
    );
    return rows;
  };

  const [cutting, sewing, koli] = await Promise.all([
    loadDivisi("CUTTING"),
    loadDivisi("SEWING"),
    loadDivisi("KOLI"),
  ]);

  return { cutting, sewing, koli };
};

// ─────────────────────────────────────────────
// getDetailAktual — plan vs aktual per divisi
// Dipanggil saat user klik expand dengan mode aktual
// Parameter: startDate, endDate (periode minggu)
// ─────────────────────────────────────────────
const getDetailAktual = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       y.pl_nomor     AS Nomor,
       y.pl_spk_nomor AS NomorSPK,
       s.spk_nama     AS NamaOrder,
       s.spk_jumlah   AS QtySPK,
       DATE_FORMAT(y.pl_tgl1, '%Y-%m-%d') AS TglAwal,
       DATE_FORMAT(y.pl_tgl2, '%Y-%m-%d') AS TglAkhir,
       y.pl_cab       AS Cabang,
       y.pl_close     AS Close,

       -- ── CUTTING PLAN ──
       DATE_FORMAT(pc.plan_tgl_jadwal, '%Y-%m-%d') AS cutting_tgl_plan,
       pc.plan_wip        AS cutting_wip_plan,
       pc.plan_qty_po     AS cutting_qty_po_plan,
       pc.plan_qty_jadwal AS cutting_qty_jadwal_plan,
       pc.plan_line_kelompok AS cutting_line_plan,

       -- ── CUTTING AKTUAL (tmutasiproduksi GP001→GP012) ──
       DATE_FORMAT(MIN(ka.mph_tanggal), '%Y-%m-%d') AS cutting_tgl_aktual,
       SUM(kd.mpd_jumlah) AS cutting_qty_aktual,
       DATEDIFF(MIN(ka.mph_tanggal), pc.plan_tgl_jadwal) AS cutting_selisih_tgl,
       SUM(kd.mpd_jumlah) - pc.plan_qty_jadwal AS cutting_selisih_qty,

       -- ── SEWING PLAN ──
       DATE_FORMAT(ps.plan_tgl_jadwal, '%Y-%m-%d') AS sewing_tgl_plan,
       ps.plan_wip        AS sewing_wip_plan,
       ps.plan_qty_po     AS sewing_qty_po_plan,
       ps.plan_qty_jadwal AS sewing_qty_jadwal_plan,
       ps.plan_line_kelompok AS sewing_line_plan,

       -- ── SEWING AKTUAL (tmutasiproduksi GP003→GP004 OR GP018→GP019) ──
       DATE_FORMAT(MIN(sa.mph_tanggal), '%Y-%m-%d') AS sewing_tgl_aktual,
       SUM(sd.mpd_jumlah) AS sewing_qty_aktual,
       DATEDIFF(MIN(sa.mph_tanggal), ps.plan_tgl_jadwal) AS sewing_selisih_tgl,
       SUM(sd.mpd_jumlah) - ps.plan_qty_jadwal AS sewing_selisih_qty,

       -- ── KOLI PLAN ──
       DATE_FORMAT(pk.plan_tgl_jadwal, '%Y-%m-%d') AS koli_tgl_plan,
       pk.plan_wip        AS koli_wip_plan,
       pk.plan_qty_po     AS koli_qty_po_plan,
       pk.plan_qty_jadwal AS koli_qty_jadwal_plan,
       pk.plan_line_kelompok AS koli_line_plan,

       -- ── KOLI AKTUAL (tstbj GP013 atau GP020) ──
       DATE_FORMAT(MIN(stbj.stbj_tanggal), '%Y-%m-%d') AS koli_tgl_aktual,
       SUM(stbjd.stbjd_jumlah) AS koli_qty_aktual,
       DATEDIFF(MIN(stbj.stbj_tanggal), pk.plan_tgl_jadwal) AS koli_selisih_tgl,
       SUM(stbjd.stbjd_jumlah) - pk.plan_qty_jadwal AS koli_selisih_qty

     FROM tplan_ppic_hdr y
     LEFT JOIN tspk s ON s.spk_nomor = y.pl_spk_nomor

     -- Plan cutting (ambil baris pertama per nomor plan)
     LEFT JOIN (
       SELECT plan_pl_nomor,
              MIN(plan_tgl_jadwal)  AS plan_tgl_jadwal,
              SUM(plan_wip)         AS plan_wip,
              SUM(plan_qty_po)      AS plan_qty_po,
              SUM(plan_qty_jadwal)  AS plan_qty_jadwal,
              GROUP_CONCAT(DISTINCT plan_line_kelompok ORDER BY plan_tgl_jadwal SEPARATOR ', ')
                AS plan_line_kelompok
       FROM tplan_ppic_dtl2
       WHERE plan_divisi = 'CUTTING'
       GROUP BY plan_pl_nomor
     ) pc ON pc.plan_pl_nomor = y.pl_nomor

     -- Plan sewing
     LEFT JOIN (
       SELECT plan_pl_nomor,
              MIN(plan_tgl_jadwal)  AS plan_tgl_jadwal,
              SUM(plan_wip)         AS plan_wip,
              SUM(plan_qty_po)      AS plan_qty_po,
              SUM(plan_qty_jadwal)  AS plan_qty_jadwal,
              GROUP_CONCAT(DISTINCT plan_line_kelompok ORDER BY plan_tgl_jadwal SEPARATOR ', ')
                AS plan_line_kelompok
       FROM tplan_ppic_dtl2
       WHERE plan_divisi = 'SEWING'
       GROUP BY plan_pl_nomor
     ) ps ON ps.plan_pl_nomor = y.pl_nomor

     -- Plan koli
     LEFT JOIN (
       SELECT plan_pl_nomor,
              MIN(plan_tgl_jadwal)  AS plan_tgl_jadwal,
              SUM(plan_wip)         AS plan_wip,
              SUM(plan_qty_po)      AS plan_qty_po,
              SUM(plan_qty_jadwal)  AS plan_qty_jadwal,
              GROUP_CONCAT(DISTINCT plan_line_kelompok ORDER BY plan_tgl_jadwal SEPARATOR ', ')
                AS plan_line_kelompok
       FROM tplan_ppic_dtl2
       WHERE plan_divisi = 'KOLI'
       GROUP BY plan_pl_nomor
     ) pk ON pk.plan_pl_nomor = y.pl_nomor

     -- Aktual cutting
     LEFT JOIN tmutasiproduksi_hdr ka
       ON ka.mph_spk_nomor = y.pl_spk_nomor
       AND ka.mph_gdgasal   = 'GP001'
       AND ka.mph_gdgtujuan = 'GP012'
       AND ka.mph_tanggal BETWEEN ? AND ?
     LEFT JOIN tmutasiproduksi_dtl kd
       ON kd.mpd_mph_nomor = ka.mph_nomor
       AND kd.mpd_nama = 'BADAN DEPAN'

     -- Aktual sewing
     LEFT JOIN tmutasiproduksi_hdr sa
       ON sa.mph_spk_nomor = y.pl_spk_nomor
       AND ((sa.mph_gdgasal = 'GP003' AND sa.mph_gdgtujuan = 'GP004')
         OR (sa.mph_gdgasal = 'GP018' AND sa.mph_gdgtujuan = 'GP019'))
       AND sa.mph_tanggal BETWEEN ? AND ?
     LEFT JOIN tmutasiproduksi_dtl sd
       ON sd.mpd_mph_nomor = sa.mph_nomor

     -- Aktual koli (dari tstbj)
     LEFT JOIN tstbj_hdr stbj
       ON stbj.stbj_gdgp_kode IN ('GP013','GP020')
       AND stbj.stbj_tanggal BETWEEN ? AND ?
     LEFT JOIN tstbj_dtl stbjd
       ON stbjd.stbjd_stbj_nomor = stbj.stbj_nomor
       AND stbjd.stbjd_spk_nomor  = y.pl_spk_nomor

     WHERE y.pl_tgl1 = ? AND y.pl_tgl2 = ?
     GROUP BY
       y.pl_nomor, y.pl_spk_nomor, s.spk_nama, s.spk_jumlah,
       y.pl_tgl1, y.pl_tgl2, y.pl_cab, y.pl_close,
       pc.plan_tgl_jadwal, pc.plan_wip, pc.plan_qty_po,
         pc.plan_qty_jadwal, pc.plan_line_kelompok,
       ps.plan_tgl_jadwal, ps.plan_wip, ps.plan_qty_po,
         ps.plan_qty_jadwal, ps.plan_line_kelompok,
       pk.plan_tgl_jadwal, pk.plan_wip, pk.plan_qty_po,
         pk.plan_qty_jadwal, pk.plan_line_kelompok
     ORDER BY y.pl_nomor ASC`,
    [
      startDate,
      endDate, // cutting aktual
      startDate,
      endDate, // sewing aktual
      startDate,
      endDate, // koli aktual
      startDate,
      endDate, // WHERE pl_tgl1 & pl_tgl2
    ],
  );
  return rows;
};

// ─────────────────────────────────────────────
// toggleClose
// ─────────────────────────────────────────────
const toggleClose = async (nomor, isClose) => {
  const [rows] = await db.query(
    `SELECT pl_close FROM tplan_ppic_hdr WHERE pl_nomor = ?`,
    [nomor],
  );
  if (!rows.length) throw new Error("Data tidak ditemukan.");
  if (isClose && rows[0].pl_close === "Y")
    throw new Error("Planning ini sudah Close.");
  if (!isClose && rows[0].pl_close === "N")
    throw new Error("Planning ini sudah Open.");

  await db.query(`UPDATE tplan_ppic_hdr SET pl_close = ? WHERE pl_nomor = ?`, [
    isClose ? "Y" : "N",
    nomor,
  ]);
};

// ─────────────────────────────────────────────
// deleteData
// ─────────────────────────────────────────────
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tplan_ppic_dtl2 WHERE plan_pl_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tplan_ppic_dtl  WHERE pld_nomor = ?`, [
      nomor,
    ]);
    await conn.query(`DELETE FROM tplan_ppic_hdr  WHERE pl_nomor = ?`, [nomor]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// Export master
// ─────────────────────────────────────────────
const getExportMaster = async (startDate, endDate) => {
  return getBrowse(startDate, endDate);
};

// ─────────────────────────────────────────────
// Export detail — flat per divisi
// ─────────────────────────────────────────────
const getExportDetail = async (startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT
       h.pl_nomor        AS NomorPlan,
       DATE_FORMAT(h.pl_tgl1, '%Y-%m-%d') AS TglAwal,
       DATE_FORMAT(h.pl_tgl2, '%Y-%m-%d') AS TglAkhir,
       h.pl_cab          AS Cabang,
       d.plan_spk        AS NomorSPK,
       s.spk_nama        AS NamaOrder,
       s.spk_jumlah      AS QtySPK,
       d.plan_divisi     AS Divisi,
       DATE_FORMAT(d.plan_tgl_jadwal, '%Y-%m-%d') AS TglJadwal,
       d.plan_wip        AS Wip,
       d.plan_qty_po     AS QtyPO,
       d.plan_qty_jadwal AS QtyJadwal,
       d.plan_line_kelompok AS LineKelompok
     FROM tplan_ppic_dtl2 d
     INNER JOIN tplan_ppic_hdr h ON h.pl_nomor = d.plan_pl_nomor
     LEFT JOIN tspk s ON s.spk_nomor = d.plan_spk
     WHERE h.pl_tgl1 BETWEEN ? AND ?
     ORDER BY h.pl_nomor ASC, d.plan_divisi ASC, d.plan_tgl_jadwal ASC`,
    [startDate, endDate],
  );
  return rows;
};

module.exports = {
  generateNomor,
  getBrowse,
  getDetail,
  getDetailAktual,
  toggleClose,
  deleteData,
  getExportMaster,
  getExportDetail,
};
