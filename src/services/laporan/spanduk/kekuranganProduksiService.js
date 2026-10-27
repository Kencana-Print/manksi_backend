const db = require("../../../config/database");
const { validasiPeriode } = require("../../spanduk/lhk/lhkCommon");

const DIVISI_SPANDUK = 1;

const angka = (v) => Number(v) || 0;
const dua = (v) => Math.round(angka(v) * 100) / 100;
const petakan = (rows, kolomSpk, kolomNilai) =>
  new Map(rows.map((r) => [String(r[kolomSpk]).toUpperCase(), r[kolomNilai]]));

// Kekurangan produksi = Jml Order - total LHK (semua waktu), per SPK.
// Meter = kurang pcs x panjang. Nilai negatif = produksi melebihi order.
const getKekuranganProduksi = async ({ tglAwal, tglAkhir, perusahaan }) => {
  validasiPeriode(tglAwal, tglAkhir);

  const params = [DIVISI_SPANDUK, tglAwal, tglAkhir];
  let sqlPerush = "";
  const kodePerush = String(perusahaan ?? "").trim();
  if (kodePerush) {
    sqlPerush = "AND s.spk_perush_kode = ?";
    params.push(kodePerush);
  }

  const [master] = await db.query(
    `SELECT s.spk_nomor AS Nomor,
            DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d %H:%i:%s') AS Tanggal,
            DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Deadline,
            s.spk_nama AS Nama,
            s.spk_panjang AS Panjang,
            s.spk_lebar AS Lebar,
            s.spk_jumlah AS Jml_Order
     FROM kencanaprint.tspk s
     WHERE s.spk_divisi = ?
       AND s.spk_aktif = 'Y'
       AND s.spk_tanggal >= ?
       AND s.spk_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
       ${sqlPerush}
     ORDER BY s.spk_tanggal, s.spk_nomor`,
    params,
  );
  if (master.length === 0) {
    return [];
  }

  const daftar = master.map((m) => m.Nomor);
  const [cetak, jahit, lipat] = await Promise.all([
    db.query(
      `SELECT lcd_spk_nomor AS spk, SUM(IFNULL(lcd_qty_cetak, 0)) AS v
       FROM kencanaprint.tlhk_cetak_dtl WHERE lcd_spk_nomor IN (?)
       GROUP BY lcd_spk_nomor`,
      [daftar],
    ),
    db.query(
      `SELECT ljd_spk_nomor AS spk, SUM(IFNULL(ljd_qty_jahit, 0)) AS v
       FROM kencanaprint.tlhk_jahit_dtl WHERE ljd_spk_nomor IN (?)
       GROUP BY ljd_spk_nomor`,
      [daftar],
    ),
    db.query(
      `SELECT lld_spk_nomor AS spk, SUM(IFNULL(lld_qty_lipat, 0)) AS v
       FROM kencanaprint.tlhk_lipat_dtl WHERE lld_spk_nomor IN (?)
       GROUP BY lld_spk_nomor`,
      [daftar],
    ),
  ]);

  const pCetak = petakan(cetak[0], "spk", "v");
  const pJahit = petakan(jahit[0], "spk", "v");
  const pLipat = petakan(lipat[0], "spk", "v");

  return master.map((m) => {
    const k = String(m.Nomor).toUpperCase();
    const panjang = angka(m.Panjang);
    const order = angka(m.Jml_Order);
    const kurangCetak = order - angka(pCetak.get(k));
    const kurangJahit = order - angka(pJahit.get(k));
    const kurangLipat = order - angka(pLipat.get(k));

    return {
      ...m,
      Panjang: panjang,
      Lebar: angka(m.Lebar),
      Jml_Order: order,
      Kurang_Cetak: dua(kurangCetak),
      Kurang_Jahit: dua(kurangJahit),
      Kurang_Lipat: dua(kurangLipat),
      Kurang_Cetak_M: dua(kurangCetak * panjang),
      Kurang_Jahit_M: dua(kurangJahit * panjang),
      Kurang_Lipat_M: dua(kurangLipat * panjang),
    };
  });
};

module.exports = { getKekuranganProduksi };
