const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const dua = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Satu baris per LHK Cetak x kain. Hanya LHK yang punya baris kain.
const getPemakaianBahan = async (tglAwal, tglAkhir) => {
  validasiPeriode(tglAwal, tglAkhir);

  const [rows] = await db.query(
    `
    SELECT
      CONCAT(h.lch_nomor, '|', k.lck_brg_kode)        AS Kunci,
      DATE_FORMAT(h.lch_tanggal, '%Y-%m-%d')          AS Tanggal,
      h.lch_nomor                                     AS Nomor_LHK,
      h.lch_sesi                                      AS Sesi,
      h.lch_pab_kode                                  AS Kode_Pabrik,
      k.lck_brg_kode                                  AS Kode_Bahan,
      b.brg_nama                                      AS Nama_Bahan,
      b.brg_lebar                                     AS Lebar,
      k.lck_qty_meter                                 AS Qty_Meter
    FROM kencanaprint.tlhk_cetak_hdr h
    INNER JOIN kencanaprint.tlhk_cetak_kain k ON k.lck_lch_nomor = h.lch_nomor
    LEFT JOIN kencanaprint.tbarang_new b ON b.brg_kode = k.lck_brg_kode
    WHERE h.lch_tanggal >= ? AND h.lch_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY h.lch_tanggal, h.lch_nomor, b.brg_nama, k.lck_brg_kode
    `,
    [tglAwal, tglAkhir],
  );

  return rows.map((r) => ({ ...r, Qty_Meter: dua(r.Qty_Meter) }));
};

module.exports = { getPemakaianBahan };
