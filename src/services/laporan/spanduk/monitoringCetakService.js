const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const DIVISI_SPANDUK = 1;

const angka = (v) => Number(v) || 0;

// Monitoring Cetak (Delphi: ufrmbrowsemonitorcetak)
// Sumber: LHK Cetak (hdr + dtl) pada periode lch_tanggal, dikelompokkan per SPK.
// Semua jumlah hanya dari LHK dalam periode (bukan kumulatif).
// Data: lch_pab_kode yang ada hanya P02, MT1, P03, P05, kosong. P01 dan P99 tidak ada,
// kode selain P01/P02/P99 tidak dihitung (sama dengan Delphi).
const getMonitoringCetak = async (tglAwal, tglAkhir, perusahaan, user) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [tglAwal, tglAkhir, DIVISI_SPANDUK];

  let sqlPerusahaan = "";
  const kode = String(perusahaan ?? "").trim();
  if (kode) {
    sqlPerusahaan = "AND s.spk_perush_kode = ?";
    params.push(kode);
  }

  const [rows] = await db.query(
    `SELECT
        ELT(WEEKDAY(MIN(h.lch_tanggal)) + 1,
            'Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu') AS Hari,
        DATE_FORMAT(MIN(h.lch_tanggal), '%Y-%m-%d') AS Tanggal,
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
        SUM(IF(h.lch_pab_kode IN ('P99','P01','P02'),
               IFNULL(d.lcd_qty_cetak, 0), 0))
          - IFNULL(s.spk_jumlah, 0) AS Kurang,
        SUM(IF(h.lch_pab_kode = 'P99', IFNULL(d.lcd_qty_cetak, 0), 0)) AS Jml_Luar,
        SUM(IF(h.lch_pab_kode = 'P02', IFNULL(d.lcd_qty_cetak, 0), 0)) AS Jml_P02,
        SUM(IF(h.lch_pab_kode IN ('P01','P02'),
               IFNULL(d.lcd_qty_cetak, 0), 0)) AS Jml_Cetak,
        SUM(IF(h.lch_pab_kode = 'P02',
               IFNULL(d.lcd_qty_cetak, 0) * IFNULL(s.spk_panjang, 0), 0)) AS Meter_P02,
        SUM(IF(h.lch_pab_kode IN ('P01','P02'),
               IFNULL(d.lcd_qty_cetak, 0) * IFNULL(s.spk_panjang, 0), 0)) AS Meter_Cetak
     FROM kencanaprint.tlhk_cetak_hdr h
     JOIN kencanaprint.tlhk_cetak_dtl d ON d.lcd_lch_nomor = h.lch_nomor
     JOIN kencanaprint.tspk s ON s.spk_nomor = d.lcd_spk_nomor
     WHERE h.lch_tanggal >= ?
       AND h.lch_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       AND s.spk_divisi = ?
       ${sqlPerusahaan}
     GROUP BY s.spk_nomor, s.spk_perush_kode, s.spk_tanggal, s.spk_dateline,
              s.spk_jo_kode, s.spk_nama, s.spk_panjang, s.spk_lebar,
              s.spk_jumlah, s.spk_kain
     ORDER BY s.spk_nomor`,
    params,
  );

  return rows.map((r) => ({
    Hari: r.Hari,
    Tanggal: r.Tanggal,
    Perusahaan: r.Perusahaan,
    Tgl_SPK: r.Tgl_SPK,
    Deadline: r.Deadline,
    Jenis_Order: r.Jenis_Order,
    Nama: r.Nama,
    Nomor: r.Nomor,
    Panjang: angka(r.Panjang),
    Lebar: angka(r.Lebar),
    Jml_Order: angka(r.Jml_Order),
    J_Meter: angka(r.J_Meter),
    Kain: r.Kain,
    Kurang: angka(r.Kurang),
    Jml_Luar: angka(r.Jml_Luar),
    Jml_P02: angka(r.Jml_P02),
    Jml_Cetak: angka(r.Jml_Cetak),
    Meter_P02: Math.round(angka(r.Meter_P02) * 100) / 100,
    Meter_Cetak: Math.round(angka(r.Meter_Cetak) * 100) / 100,
  }));
};

module.exports = { getMonitoringCetak };
