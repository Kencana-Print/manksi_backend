const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bulat = (n) => Math.round(Number(n) || 0);

const getMonitoringCuiring = async (tglAwal, tglAkhir, perusahaan) => {
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
      ELT(WEEKDAY(MIN(h.lqh_tanggal)) + 1,
          'Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')   AS Hari,
      DATE_FORMAT(MIN(h.lqh_tanggal), '%Y-%m-%d')                      AS Tanggal,
      s.spk_perush_kode                                                AS Perusahaan,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d')                           AS Tgl_SPK,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d')                          AS Deadline,
      s.spk_nama                                                       AS Nama,
      s.spk_nomor                                                      AS Nomor,
      s.spk_panjang                                                    AS Panjang,
      s.spk_lebar                                                      AS Lebar,
      IFNULL(s.spk_jumlah, 0)                                          AS Jml_Order,
      IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_jumlah, 0)               AS J_Meter,
      s.spk_kain                                                       AS Kain,
      IFNULL(s.spk_jumlah, 0) - SUM(IFNULL(d.lqd_j_oven, 0))           AS Kurang_Oven,
      IFNULL(s.spk_jumlah, 0) - SUM(IFNULL(d.lqd_j_jemuran, 0))        AS Kurang_Jemuran,
      IFNULL(s.spk_jumlah, 0) - SUM(IFNULL(d.lqd_j_potong, 0))         AS Kurang_Potong,
      SUM(IFNULL(d.lqd_j_oven, 0))                                     AS Oven,
      SUM(IFNULL(d.lqd_j_jemuran, 0))                                  AS Jemuran,
      SUM(IFNULL(d.lqd_j_potong, 0))                                   AS Potong,
      SUM(IFNULL(d.lqd_j_oven, 0)) * IFNULL(s.spk_panjang, 0)          AS Meter_Oven
    FROM kencanaprint.tlhk_quiring_hdr h
    INNER JOIN kencanaprint.tlhk_quiring_dtl d ON d.lqd_lqh_nomor = h.lqh_nomor
    INNER JOIN kencanaprint.tspk s             ON s.spk_nomor = d.lqd_spk_nomor
    WHERE h.lqh_tanggal >= ?
      AND h.lqh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      ${sqlPerusahaan}
    GROUP BY s.spk_nomor, s.spk_perush_kode, s.spk_tanggal, s.spk_dateline,
             s.spk_nama, s.spk_panjang, s.spk_lebar, s.spk_jumlah, s.spk_kain
    ORDER BY s.spk_nomor
    `,
    params,
  );

  return rows.map((r) => ({
    ...r,
    Jml_Order: dua(r.Jml_Order),
    J_Meter: dua(r.J_Meter),
    Kurang_Oven: dua(r.Kurang_Oven),
    Kurang_Jemuran: dua(r.Kurang_Jemuran),
    Kurang_Potong: dua(r.Kurang_Potong),
    Oven: bulat(r.Oven),
    Jemuran: bulat(r.Jemuran),
    Potong: bulat(r.Potong),
    Meter_Oven: dua(r.Meter_Oven),
  }));
};

module.exports = { getMonitoringCuiring };
