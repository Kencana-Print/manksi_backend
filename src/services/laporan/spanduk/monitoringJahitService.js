const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const DIVISI_SPANDUK = 1;

const angka = (v) => Number(v) || 0;
const dua = (v) => Math.round(angka(v) * 100) / 100;

// Laporan Monitoring Jahit (Delphi: ufrmbrowsemonitorjahit)
// Per SPK yang punya LHK Jahit pada periode. Luar = kode pabrik P01 (sesuai Delphi),
// Jumlah = P01 + P02, Kurang = (P99 + P01 + P02) - jumlah order.
const getMonitoringJahit = async (tglAwal, tglAkhir, perusahaan) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [tglAwal, tglAkhir, DIVISI_SPANDUK];
  let sqlPerush = "";
  const kodePerush = String(perusahaan ?? "").trim();
  if (kodePerush) {
    sqlPerush = "AND s.spk_perush_kode = ?";
    params.push(kodePerush);
  }

  const [rows] = await db.query(
    `SELECT ELT(WEEKDAY(MIN(h.ljh_tanggal)) + 1,
                'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu') AS Hari,
            DATE_FORMAT(MIN(h.ljh_tanggal), '%Y-%m-%d') AS Tanggal,
            s.spk_perush_kode AS Perusahaan,
            DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tgl_SPK,
            DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Deadline,
            s.spk_jo_kode AS Jenis_Order,
            s.spk_nama AS Nama,
            s.spk_nomor AS Nomor,
            s.spk_panjang AS Panjang,
            s.spk_lebar AS Lebar,
            s.spk_jumlah AS Jml_Order,
            IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_jumlah, 0) AS J_Meter,
            s.spk_kain AS Kain,
            SUM(IF(h.ljh_pab_kode IN ('P99', 'P01', 'P02'),
                   IFNULL(d.ljd_qty_jahit, 0), 0)) - IFNULL(s.spk_jumlah, 0) AS Kurang,
            SUM(IF(h.ljh_pab_kode = 'P01', IFNULL(d.ljd_qty_jahit, 0), 0)) AS Jml_Luar,
            SUM(IF(h.ljh_pab_kode = 'P02', IFNULL(d.ljd_qty_jahit, 0), 0)) AS Jml_P02,
            SUM(IF(h.ljh_pab_kode IN ('P01', 'P02'),
                   IFNULL(d.ljd_qty_jahit, 0), 0)) AS Jml_Jahit,
            SUM(IF(h.ljh_pab_kode = 'P01', IFNULL(d.ljd_qty_jahit, 0), 0))
              * IFNULL(s.spk_panjang, 0) AS Meter_Luar,
            SUM(IF(h.ljh_pab_kode = 'P02', IFNULL(d.ljd_qty_jahit, 0), 0))
              * IFNULL(s.spk_panjang, 0) AS Meter_P02,
            SUM(IF(h.ljh_pab_kode IN ('P01', 'P02'),
                   IFNULL(d.ljd_qty_jahit, 0), 0))
              * IFNULL(s.spk_panjang, 0) AS Meter_Jahit
     FROM kencanaprint.tlhk_jahit_hdr h
     JOIN kencanaprint.tlhk_jahit_dtl d ON d.ljd_ljh_nomor = h.ljh_nomor
     JOIN kencanaprint.tspk s ON s.spk_nomor = d.ljd_spk_nomor
     WHERE h.ljh_tanggal >= ?
       AND h.ljh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       AND s.spk_divisi = ?
       ${sqlPerush}
     GROUP BY s.spk_nomor, s.spk_perush_kode, s.spk_tanggal, s.spk_dateline,
              s.spk_jo_kode, s.spk_nama, s.spk_panjang, s.spk_lebar,
              s.spk_jumlah, s.spk_kain
     ORDER BY s.spk_nomor`,
    params,
  );

  return rows.map((r) => ({
    ...r,
    Panjang: angka(r.Panjang),
    Lebar: angka(r.Lebar),
    Jml_Order: angka(r.Jml_Order),
    J_Meter: dua(r.J_Meter),
    Kurang: dua(r.Kurang),
    Jml_Luar: dua(r.Jml_Luar),
    Jml_P02: dua(r.Jml_P02),
    Jml_Jahit: dua(r.Jml_Jahit),
    Meter_Luar: dua(r.Meter_Luar),
    Meter_P02: dua(r.Meter_P02),
    Meter_Jahit: dua(r.Meter_Jahit),
  }));
};

module.exports = { getMonitoringJahit };
