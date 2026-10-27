const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;

const getMonitoringKoli = async (tglAwal, tglAkhir, perusahaan) => {
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
      ELT(WEEKDAY(h.lkh_tanggal) + 1,
          'Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')   AS Hari,
      DATE_FORMAT(h.lkh_tanggal, '%Y-%m-%d')                           AS Tanggal,
      h.lkh_nomor                                                      AS Nomor_LHK,
      s.spk_perush_kode                                                AS Perusahaan,
      DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d')                           AS Tgl_SPK,
      DATE_FORMAT(s.spk_dateline, '%Y-%m-%d')                          AS Deadline,
      s.spk_nama                                                       AS Nama,
      s.spk_nomor                                                      AS Nomor,
      CONCAT(h.lkh_nomor, '|', s.spk_nomor)                            AS Kunci,
      s.spk_panjang                                                    AS Panjang,
      s.spk_lebar                                                      AS Lebar,
      IFNULL(s.spk_jumlah, 0)                                          AS Jml_Order,
      IFNULL(s.spk_panjang, 0) * IFNULL(s.spk_jumlah, 0)               AS J_Meter,
      s.spk_kain                                                       AS Kain,
      IFNULL(d.lkd_j_koli, 0)                                          AS J_Koli
    FROM kencanaprint.tlhk_koli_hdr h
    INNER JOIN kencanaprint.tlhk_koli_dtl d ON d.lkd_lkh_nomor = h.lkh_nomor
    INNER JOIN kencanaprint.tspk s          ON s.spk_nomor = d.lkd_spk_nomor
    WHERE h.lkh_tanggal >= ?
      AND h.lkh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
      ${sqlPerusahaan}
    ORDER BY h.lkh_tanggal, h.lkh_nomor, s.spk_nomor
    `,
    params,
  );

  return rows.map((r) => ({
    ...r,
    Jml_Order: dua(r.Jml_Order),
    J_Meter: dua(r.J_Meter),
    J_Koli: Number(r.J_Koli) || 0,
  }));
};

module.exports = { getMonitoringKoli };
