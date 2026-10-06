const db = require("../../config/database");

/**
 * Progress LHK DTF sebuah Maklon.
 * excludeCab+excludeTanggal: abaikan LHK pada cab+tanggal tsb (dipakai saat
 * mengedit LHK yang sedang dibuka, supaya tidak menghitung dirinya sendiri).
 */
const getProgress = async (
  mklNomor,
  { conn = db, excludeCab = null, excludeTanggal = null } = {},
) => {
  const [[r]] = await conn.query(
    `SELECT IFNULL(SUM(j.mkldj_estimasi_qty), 0) AS rencana
     FROM tmaklon_dtl d
     INNER JOIN tmaklon_dtl_jadi j ON j.mkldj_mkld_id = d.mkld_id
     WHERE d.mkld_mkl_nomor = ?`,
    [mklNomor],
  );
  const [[k]] = await conn.query(
    `SELECT IFNULL(SUM(mkld_qty_sudah_kirim), 0) AS totalKirim
     FROM tmaklon_dtl WHERE mkld_mkl_nomor = ?`,
    [mklNomor],
  );

  const excl =
    excludeCab && excludeTanggal
      ? "AND NOT (dm.cab = ? AND dm.tanggal = ?)"
      : "";
  const exclParams = excl ? [excludeCab, excludeTanggal] : [];

  const [[h]] = await conn.query(
    `SELECT IFNULL(SUM(dh.dmh_qty_hasil + dh.dmh_bs_afval), 0) AS hasil
     FROM tdtf_maklon dm
     INNER JOIN tdtf_maklon_hasil dh ON dh.dmh_dtf_maklon_id = dm.id
     WHERE dm.mkl_nomor = ? ${excl}`,
    [mklNomor, ...exclParams],
  );
  const [[m]] = await conn.query(
    `SELECT IFNULL(SUM(dm.qty_masuk), 0) AS masuk
     FROM tdtf_maklon dm
     WHERE dm.mkl_nomor = ? ${excl}`,
    [mklNomor, ...exclParams],
  );

  const rencana = Number(r.rencana) || 0;
  const hasil = Number(h.hasil) || 0;
  const masuk = Number(m.masuk) || 0;
  const totalKirim = Number(k.totalKirim) || 0;
  return {
    rencana,
    hasil,
    sisaHasil: Math.max(rencana - hasil, 0),
    masuk,
    totalKirim,
    sisaPolos: Math.max(totalKirim - masuk, 0),
    selesai: rencana > 0 && hasil >= rencana,
  };
};

module.exports = { getProgress };
