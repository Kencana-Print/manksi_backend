const db = require("../../../config/database");
const {
  validasiPeriode,
  adalahSuperadmin,
  cabangUser,
} = require("../../spanduk/lhk/lhkCommon");

const DIVISI_SPANDUK = 1;

const angka = (v) => Number(v) || 0;
const bulat = (v) => Math.round(angka(v));
const dua = (v) => Math.round(angka(v) * 100) / 100;

// Total per SPK (semua waktu), hasil: Map nomor(UPPER) -> nilai
const petakan = (rows, kolomSpk, kolomNilai) =>
  new Map(rows.map((r) => [String(r[kolomSpk]).toUpperCase(), r[kolomNilai]]));

const getOutputBySpk = async (tglAwal, tglAkhir, user) => {
  validasiPeriode(tglAwal, tglAkhir);

  // 1) Daftar SPK: yang punya LHK Cetak pada periode (divisi Spanduk, aktif)
  const params = [tglAwal, tglAkhir, DIVISI_SPANDUK];
  let sqlCab = "";
  if (!adalahSuperadmin(user)) {
    sqlCab = "AND s.spk_cab = ?";
    params.push(cabangUser(user));
  }
  const [master] = await db.query(
    `SELECT s.spk_nomor AS Nomor,
            s.spk_memo AS Memo,
            DATE_FORMAT(s.spk_tanggal, '%Y-%m-%d') AS Tanggal,
            DATE_FORMAT(s.spk_dateline, '%Y-%m-%d') AS Deadline,
            s.spk_nama AS Nama,
            sl.sal_nama AS Sales,
            dv.divisi AS Divisi,
            jo.jo_nama AS Jenis_Order,
            IF(s.spk_jumlah_kirim >= s.spk_jumlah, 'Closed', 'Open') AS Status,
            s.spk_panjang AS Panjang,
            s.spk_lebar AS Lebar,
            s.spk_kain AS Kain,
            s.spk_finishing AS Finishing,
            s.spk_jumlah AS Jml_Order,
            s.spk_jumlah_jadi AS Jml_Jadi,
            s.spk_jumlah_kirim AS Jml_Kirim
     FROM (
       SELECT d.lcd_spk_nomor AS nomor
       FROM kencanaprint.tlhk_cetak_dtl d
       JOIN kencanaprint.tlhk_cetak_hdr h ON h.lch_nomor = d.lcd_lch_nomor
       WHERE h.lch_tanggal BETWEEN ? AND ?
       GROUP BY d.lcd_spk_nomor
     ) x
     JOIN kencanaprint.tspk s
       ON s.spk_nomor = x.nomor AND s.spk_aktif = 'Y' AND s.spk_divisi = ?
     LEFT JOIN kencanaprint.tsales sl ON sl.sal_kode = s.spk_sal_kode
     LEFT JOIN kencanaprint.tjenisorder jo
       ON jo.jo_kode = s.spk_jo_kode AND jo.jo_divisi = s.spk_divisi
     LEFT JOIN kencanaprint.tdivisi dv ON dv.kode = s.spk_divisi
     WHERE 1 = 1
     ${sqlCab}
     ORDER BY s.spk_nomor`,
    params,
  );
  if (master.length === 0) {
    return [];
  }

  // 2) Total per SPK (semua waktu, bukan hanya periode), sama dengan Delphi
  const daftar = master.map((m) => m.Nomor);
  const [cetak, jahit, lipat, koliLama, koliBaru, mmt] = await Promise.all([
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
    db.query(
      `SELECT lqd_spk_nomor AS spk, SUM(IFNULL(lqd_j_koli, 0)) AS v
       FROM kencanaprint.tlhk_quiring_dtl WHERE lqd_spk_nomor IN (?)
       GROUP BY lqd_spk_nomor`,
      [daftar],
    ),
    db.query(
      `SELECT lkd_spk_nomor AS spk, SUM(IFNULL(lkd_j_koli, 0)) AS v
       FROM kencanaprint.tlhk_koli_dtl WHERE lkd_spk_nomor IN (?)
       GROUP BY lkd_spk_nomor`,
      [daftar],
    ),
    db.query(
      `SELECT lcd_spk_nomor AS spk,
              SUM(IF(lcd_jns_mesin = 'MT01', lcd_qty_cetak, 0)) AS mt01,
              SUM(IF(lcd_jns_mesin = 'MT02', lcd_qty_cetak, 0)) AS mt02,
              SUM(IF(lcd_jns_mesin = 'MT03', lcd_qty_cetak, 0)) AS mt03,
              SUM(IF(lcd_jns_mesin = 'MT04', lcd_qty_cetak, 0)) AS mt04,
              SUM(IF(lcd_jns_mesin = 'MT05', lcd_qty_cetak, 0)) AS mt05,
              SUM(IF(lcd_jns_mesin = 'MI', lcd_qty_cetak, 0)) AS mi
       FROM kencanaprint.tlhk_cetakmmt_dtl WHERE lcd_spk_nomor IN (?)
       GROUP BY lcd_spk_nomor`,
      [daftar],
    ),
  ]);

  const pCetak = petakan(cetak[0], "spk", "v");
  const pJahit = petakan(jahit[0], "spk", "v");
  const pLipat = petakan(lipat[0], "spk", "v");
  const pKoliLama = petakan(koliLama[0], "spk", "v");
  const pKoliBaru = petakan(koliBaru[0], "spk", "v");
  const pMmt = new Map(mmt[0].map((r) => [String(r.spk).toUpperCase(), r]));

  return master.map((m) => {
    const k = String(m.Nomor).toUpperCase();
    const panjang = angka(m.Panjang);
    const lebar = angka(m.Lebar);
    // SPK berkode MX (posisi 4-5): lebar dianggap 1 pada meter MT
    const lebarMt = String(m.Nomor).substr(3, 2) === "MX" ? 1 : lebar;

    const jmlCetak = bulat(pCetak.get(k));
    const jmlJahit = bulat(pJahit.get(k));
    const jmlLipat = bulat(pLipat.get(k));
    const jmlKoli = bulat(angka(pKoliLama.get(k)) + angka(pKoliBaru.get(k)));

    const mm = pMmt.get(k) ?? {};
    const mt = (kode) => bulat(mm[kode]);

    return {
      ...m,
      Panjang: panjang,
      Lebar: lebar,
      Jml_Order: angka(m.Jml_Order),
      Jml_Jadi: angka(m.Jml_Jadi),
      Jml_Kirim: angka(m.Jml_Kirim),
      MT01: mt("mt01"),
      MT02: mt("mt02"),
      MT03: mt("mt03"),
      MT04: mt("mt04"),
      MT05: mt("mt05"),
      MI: mt("mi"),
      Jml_Cetak: jmlCetak,
      Jml_Jahit: jmlJahit,
      Jml_Lipat: jmlLipat,
      Jml_Koli: jmlKoli,
      MT01_M: dua(mt("mt01") * panjang * lebarMt),
      MT02_M: dua(mt("mt02") * panjang * lebarMt),
      MT03_M: dua(mt("mt03") * panjang * lebarMt),
      MT04_M: dua(mt("mt04") * panjang * lebarMt),
      MT05_M: dua(mt("mt05") * panjang * lebarMt),
      MI_M: dua(mt("mi") * panjang * lebar),
      M_Cetak: dua(jmlCetak * panjang),
      M_Jahit: dua(jmlJahit * panjang),
      M_Lipat: dua(jmlLipat * panjang),
      M_Koli: dua(jmlKoli * panjang),
    };
  });
};

module.exports = { getOutputBySpk };
