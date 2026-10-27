const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;

const getMonitoringLipat = async (tglAwal, tglAkhir, perusahaan) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [tglAwal, tglAkhir];
  let sqlPerusahaan = "";
  if (perusahaan) {
    sqlPerusahaan = "AND s.spk_perush_kode = ?";
    params.push(perusahaan);
  }

  const [rows] = await db.query(
    `
    SELECT
      ELT(WEEKDAY(MIN(h.llh_tanggal)) + 1,
          'Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')   AS Hari,
      DATE_FORMAT(MIN(h.llh_tanggal), '%Y-%m-%d')                      AS Tanggal,
      s.spk_perush_kode                                                AS Perusahaan,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d')                           AS Tgl_SPK,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d')                          AS Deadline,
      s.spk_jo_kode                                                    AS Jenis_Kode,
      jo.jo_nama                                                       AS Jenis_Nama,
      s.spk_nama                                                       AS Nama,
      s.spk_nomor                                                      AS Nomor,
      s.spk_panjang                                                    AS Panjang,
      s.spk_lebar                                                      AS Lebar,
      IFNULL(s.spk_jumlah, 0)                                          AS Jml_Order,
      IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_jumlah, 0)               AS J_Meter,
      s.spk_kain                                                       AS Kain,
      IFNULL(s.spk_jumlah, 0)
        - SUM(CASE WHEN h.llh_pab_kode IN ('P01','P02') THEN IFNULL(d.lld_qty_lipat, 0) ELSE 0 END)
        - SUM(CASE WHEN h.llh_pab_kode = 'P99'          THEN IFNULL(d.lld_qty_lipat, 0) ELSE 0 END) AS Kurang,
      SUM(CASE WHEN h.llh_pab_kode = 'P01' THEN IFNULL(d.lld_qty_lipat, 0) ELSE 0 END) AS Jml_P01,
      SUM(CASE WHEN h.llh_pab_kode = 'P02' THEN IFNULL(d.lld_qty_lipat, 0) ELSE 0 END) AS Jml_P02,
      SUM(CASE WHEN h.llh_pab_kode IN ('P01','P02') THEN IFNULL(d.lld_qty_lipat, 0) ELSE 0 END) AS Jml_Lipat,
      SUM(CASE WHEN h.llh_pab_kode = 'P01' THEN IFNULL(d.lld_qty_lipat, 0) * IFNULL(s.spk_panjang, 0) ELSE 0 END) AS Meter_P01,
      SUM(CASE WHEN h.llh_pab_kode = 'P02' THEN IFNULL(d.lld_qty_lipat, 0) * IFNULL(s.spk_panjang, 0) ELSE 0 END) AS Meter_P02,
      SUM(CASE WHEN h.llh_pab_kode IN ('P01','P02') THEN IFNULL(d.lld_qty_lipat, 0) * IFNULL(s.spk_panjang, 0) ELSE 0 END) AS Meter_Lipat
    FROM kencanaprint.tlhk_lipat_hdr h
    INNER JOIN kencanaprint.tlhk_lipat_dtl d ON d.lld_llh_nomor = h.llh_nomor
    INNER JOIN kencanaprint.tspk s           ON s.spk_nomor = d.lld_spk_nomor
    LEFT JOIN (
      SELECT jo_kode, MIN(jo_nama) AS jo_nama
      FROM kencanaprint.tjenisorder
      GROUP BY jo_kode
    ) jo ON jo.jo_kode = s.spk_jo_kode
    WHERE h.llh_tanggal >= ?
      AND h.llh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      AND s.spk_divisi = 1
      ${sqlPerusahaan}
    GROUP BY s.spk_nomor, s.spk_perush_kode, s.spk_tanggal, s.spk_dateline,
             s.spk_jo_kode, jo.jo_nama, s.spk_nama, s.spk_panjang, s.spk_lebar,
             s.spk_jumlah, s.spk_kain
    ORDER BY s.spk_nomor
    `,
    params,
  );

  return rows.map((r) => ({
    ...r,
    Jml_Order: dua(r.Jml_Order),
    J_Meter: dua(r.J_Meter),
    Kurang: dua(r.Kurang),
    Jml_P01: dua(r.Jml_P01),
    Jml_P02: dua(r.Jml_P02),
    Jml_Lipat: dua(r.Jml_Lipat),
    Meter_P01: dua(r.Meter_P01),
    Meter_P02: dua(r.Meter_P02),
    Meter_Lipat: dua(r.Meter_Lipat),
  }));
};

module.exports = { getMonitoringLipat };
