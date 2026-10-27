const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;

const getRekapMonitoringBySpk = async (tglAwal, tglAkhir, perusahaan) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [tglAwal, tglAkhir, tglAwal, tglAkhir, tglAwal, tglAkhir];
  let filterPerusahaan = "";
  if (perusahaan) {
    filterPerusahaan = "WHERE s.spk_perush_kode = ?";
    params.push(perusahaan);
  }

  const [rows] = await db.query(
    `
    SELECT
      s.spk_perush_kode                                   AS Perusahaan,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d %H:%i:%s')     AS Tgl_SPK,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d')             AS Deadline,
      s.spk_nama                                          AS Nama_SPK,
      s.spk_panjang                                       AS Panjang,
      s.spk_lebar                                         AS Lebar,
      c.lcd_spk_nomor                                     AS Nomor_SPK,
      s.spk_jumlah                                        AS Jml_Order,
      s.spk_jumlah - IFNULL(c.qty_cetak, 0)               AS Kurang_Cetak,
      s.spk_jumlah - IFNULL(j.qty_jahit, 0)               AS Kurang_Jahit,
      s.spk_jumlah - IFNULL(l.qty_lipat, 0)               AS Kurang_Lipat
    FROM (
      SELECT d.lcd_spk_nomor, SUM(IFNULL(d.lcd_qty_Cetak, 0)) AS qty_cetak
      FROM kencanaprint.tlhk_cetak_hdr h
      INNER JOIN kencanaprint.tlhk_cetak_dtl d ON d.lcd_lch_nomor = h.lch_nomor
      WHERE h.lch_tanggal >= ? AND h.lch_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY d.lcd_spk_nomor
    ) c
    LEFT JOIN (
      SELECT spk_perush_kode, spk_nomor, spk_tanggal, spk_dateline, spk_nama,
             IFNULL(spk_panjang, 0) AS spk_panjang,
             IFNULL(spk_lebar, 0)   AS spk_lebar,
             IFNULL(spk_jumlah, 0)  AS spk_jumlah
      FROM kencanaprint.tspk
      UNION ALL
      SELECT mspk_perush_kode, mspk_nomor, mspk_tanggal, mspk_dateline, mspk_nama,
             IFNULL(mspk_panjang, 0),
             IFNULL(mspk_lebar, 0),
             IFNULL(mspk_jumlah, 0)
      FROM kencanaprint.tmemospk
    ) s ON s.spk_nomor = c.lcd_spk_nomor
    LEFT JOIN (
      SELECT d.ljd_spk_nomor, SUM(IFNULL(d.ljd_qty_jahit, 0)) AS qty_jahit
      FROM kencanaprint.tlhk_jahit_hdr h
      INNER JOIN kencanaprint.tlhk_jahit_dtl d ON d.ljd_ljh_nomor = h.ljh_nomor
      WHERE h.ljh_tanggal >= ? AND h.ljh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY d.ljd_spk_nomor
    ) j ON j.ljd_spk_nomor = c.lcd_spk_nomor
    LEFT JOIN (
      SELECT d.lld_spk_nomor, SUM(IFNULL(d.lld_qty_lipat, 0)) AS qty_lipat
      FROM kencanaprint.tlhk_lipat_hdr h
      INNER JOIN kencanaprint.tlhk_lipat_dtl d ON d.lld_llh_nomor = h.llh_nomor
      WHERE h.llh_tanggal >= ? AND h.llh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY d.lld_spk_nomor
    ) l ON l.lld_spk_nomor = c.lcd_spk_nomor
    ${filterPerusahaan}
    ORDER BY s.spk_perush_kode, c.lcd_spk_nomor
    `,
    params,
  );

  return rows.map((r) => ({
    ...r,
    Panjang: dua(r.Panjang),
    Lebar: dua(r.Lebar),
    Jml_Order: dua(r.Jml_Order),
    Kurang_Cetak: dua(r.Kurang_Cetak),
    Kurang_Jahit: dua(r.Kurang_Jahit),
    Kurang_Lipat: dua(r.Kurang_Lipat),
  }));
};

module.exports = { getRekapMonitoringBySpk };
