const { galat } = require("./lhk/lhkCommon");
const plotter = require("./lhk/lhkPlotterShared");
const hapusPlankan = require("./lhk/lhkHapusPlankanShared");
const afdruk = require("./lhk/lhkAfdrukShared");
const tinta = require("./lhk/lhkTintaShared");
const cetak = require("./lhk/lhkCetakShared");
const quiring = require("./lhk/lhkQuiringShared");
const jahit = require("./lhk/lhkJahitShared");
const lipat = require("./lhk/lhkLipatShared");

// Sampel (MAP) hanya sampai lini ini (MP-2)
const BATAS_LINI_MAP = "CETAK";

// Detail satu baris SPK di dtl LHK asal. kolom: [{key, label, sql}]
// key = alias di hasil query = kunci di JSON.
const detailSederhana = (kolom) => ({
  kolom,
  buatSql: (lini) =>
    `SELECT ${kolom.map((c) => `${c.sql} AS ${c.key}`).join(", ")}
     FROM ${lini.S.T.dtl}
     WHERE ${lini.kolom.nomorDtl} = ? AND ${lini.kolom.spkDtl} = ?`,
});

// Tinta: pemakaian bahan ada di dtl2 (satu baris per bahan)
const detailTinta = {
  kolom: [
    { key: "Kode_Bahan", label: "Kode Bahan" },
    { key: "Nama_Bahan", label: "Nama Bahan" },
    { key: "Satuan", label: "Satuan" },
    { key: "Qty", label: "Qty" },
  ],
  buatSql: (lini) =>
    `SELECT t.lnd2_brg_kode AS Kode_Bahan, b.brg_nama AS Nama_Bahan,
            b.brg_satuan AS Satuan, t.lnd2_qty AS Qty
     FROM ${lini.S.T.dtl2} t
     LEFT JOIN ${lini.S.T.barang} b ON b.brg_kode = t.lnd2_brg_kode
     WHERE t.lnd2_lnt_nomor = ? AND t.lnd2_spk_nomor = ?
     ORDER BY b.brg_nama`,
};

// Urutan array = urutan rantai (Ploter -> ... -> Lipat).
// S/kolom/detail null = LHK lini itu belum dimigrasi (isi saat modulnya jadi).
const DAFTAR_LINI = [
  {
    kode: "PLOTER",
    nama: "Plotter",
    S: plotter,
    kolom: {
      nomorHdr: "lph_nomor",
      tanggalHdr: "lph_tanggal",
      pabHdr: "lph_pab_kode",
      nomorDtl: "lpd_lph_nomor",
      spkDtl: "lpd_spk_nomor",
    },
    detail: detailSederhana([
      { key: "J_Meter", label: "J Meter", sql: "lpd_j_meter" },
      { key: "J_Lembar", label: "J Lembar", sql: "lpd_j_lembar" },
      { key: "J_TotalMeter", label: "Total Meter", sql: "lpd_j_totalmeter" },
      { key: "J_PK", label: "J PK", sql: "lpd_j_pk" },
      { key: "J_MK", label: "J MK", sql: "lpd_j_mk" },
      { key: "J_Tinta", label: "Total Tinta", sql: "lpd_j_totaltinta" },
      { key: "Keterangan", label: "Keterangan", sql: "lpd_keterangan" },
    ]),
  },
  {
    kode: "HAPUS_PLANKAN",
    nama: "Hapus Plankan",
    S: hapusPlankan,
    kolom: {
      nomorHdr: "lhp_nomor",
      tanggalHdr: "lhp_tanggal",
      pabHdr: "lhp_pab_kode",
      nomorDtl: "lhpd_lhp_nomor",
      spkDtl: "lhpd_spk_nomor",
    },
    detail: detailSederhana([
      { key: "J_Plangkan", label: "J Plangkan", sql: "lhpd_jml_plangkan" },
      { key: "Ukuran", label: "Ukuran", sql: "lhpd_ukuran" },
      { key: "J_Meter", label: "J Meter", sql: "lhpd_jumlahmeter" },
      {
        key: "Jumlah_Meter",
        label: "Jumlah Meter",
        sql: "ROUND(IFNULL(lhpd_ukuran, 0) * IFNULL(lhpd_jml_plangkan, 0), 2)",
      },
      { key: "Rinso", label: "Rinso", sql: "lhpd_rinso" },
      { key: "Porstek", label: "Porstek", sql: "lhpd_porstek" },
      { key: "M46", label: "M46", sql: "lhpd_m46" },
      { key: "Kaporit", label: "Kaporit", sql: "lhpd_kaporit" },
      { key: "Caustik", label: "Caustik", sql: "lhpd_caustik" },
      { key: "Keterangan", label: "Keterangan", sql: "lhpd_keterangan" },
    ]),
  },
  {
    kode: "AFDRUK",
    nama: "Afdruk",
    S: afdruk,
    kolom: {
      nomorHdr: "lah_nomor",
      tanggalHdr: "lah_tanggal",
      pabHdr: "lah_pab_kode",
      nomorDtl: "lad_lah_nomor",
      spkDtl: "lad_spk_nomor",
    },
    detail: detailSederhana([
      { key: "J_Plangkan", label: "J Plangkan", sql: "lad_j_plangkan" },
      { key: "Ulano", label: "Ulano", sql: "lad_ulano" },
      { key: "Screen", label: "Screen", sql: "lad_screen" },
    ]),
  },
  {
    kode: "TINTA",
    nama: "Tinta/Cat",
    S: tinta,
    kolom: {
      nomorHdr: "lnt_nomor",
      tanggalHdr: "lnt_tanggal",
      pabHdr: "lnt_pab_kode",
      nomorDtl: "lnd_lnt_nomor",
      spkDtl: "lnd_spk_nomor",
    },
    detail: detailTinta,
  },
  {
    kode: "CETAK",
    nama: "Cetak",
    S: cetak,
    kolom: {
      nomorHdr: "lch_nomor",
      tanggalHdr: "lch_tanggal",
      pabHdr: "lch_pab_kode",
      nomorDtl: "lcd_lch_nomor",
      spkDtl: "lcd_spk_nomor",
    },
    detail: detailSederhana([
      { key: "Qty_Cetak", label: "J Cetak", sql: "lcd_qty_cetak" },
      { key: "Jml_Plangkan", label: "J Plangkan", sql: "lcd_qty_plangkan" },
    ]),
  },
  {
    kode: "QUIRING",
    nama: "Quiring",
    S: quiring,
    kolom: {
      nomorHdr: "lqh_nomor",
      tanggalHdr: "lqh_tanggal",
      pabHdr: "lqh_pab_kode",
      nomorDtl: "lqd_lqh_nomor",
      spkDtl: "lqd_spk_nomor",
    },
    detail: detailSederhana([
      { key: "J_Koli", label: "J Koli", sql: "lqd_j_koli" },
      { key: "J_Oven", label: "J Oven", sql: "lqd_j_oven" },
      { key: "J_Jemuran", label: "J Jemuran", sql: "lqd_j_jemuran" },
      { key: "J_Potong", label: "J Potong", sql: "lqd_j_potong" },
    ]),
  },
  {
    kode: "JAHIT",
    nama: "Jahit",
    S: jahit,
    kolom: {
      nomorHdr: "ljh_nomor",
      tanggalHdr: "ljh_tanggal",
      pabHdr: "ljh_pab_kode",
      nomorDtl: "ljd_ljh_nomor",
      spkDtl: "ljd_spk_nomor",
    },
    detail: detailSederhana([
      { key: "Qty_Jahit", label: "Qty Jahit", sql: "ljd_qty_jahit" },
      { key: "Tambah_Jahit", label: "Tambah Jahit", sql: "ljd_tambah_jahit" },
      { key: "Tambah_Tali", label: "Tambah Tali", sql: "ljd_tambah_tali" },
    ]),
  },
  {
    kode: "LIPAT",
    nama: "Lipat",
    S: lipat,
    kolom: {
      nomorHdr: "llh_nomor",
      tanggalHdr: "llh_tanggal",
      pabHdr: "llh_pab_kode",
      nomorDtl: "lld_llh_nomor",
      spkDtl: "lld_spk_nomor",
    },
    detail: detailSederhana([
      { key: "Qty_Lipat", label: "Qty Lipat", sql: "lld_qty_lipat" },
      { key: "Tambah_Lipat", label: "Tambah Lipat", sql: "lld_tambah_lipat" },
      { key: "Mata_Ayam", label: "Mata Ayam", sql: "lld_mata_ayam" },
    ]),
  },
];

const getLini = (kode) => {
  const lini = DAFTAR_LINI.find((l) => l.kode === kode);
  if (!lini) {
    throw galat(`Lini produksi ${kode} tidak dikenal`);
  }
  return lini;
};

const namaLini = (kode) =>
  DAFTAR_LINI.find((l) => l.kode === kode)?.nama ?? kode;

// Lini asal harus sudah punya LHK di web (untuk dipanggil nomor LHK-nya)
const getLiniAsal = (kode) => {
  const lini = getLini(kode);
  if (!lini.S) {
    throw galat(
      `LHK ${lini.nama} belum tersedia di web, mutasi dari lini ini belum bisa dibuat`,
    );
  }
  return lini;
};

const indeksLini = (kode) => DAFTAR_LINI.findIndex((l) => l.kode === kode);

// Lini tujuan yang boleh untuk lini asal + jenis sumber ("SPK" | "MAP").
// Elemen pertama = lini berikutnya dalam rantai (default).
const daftarLiniTujuan = (kodeAsal, jenis) => {
  const awal = indeksLini(kodeAsal);
  if (awal < 0) {
    return [];
  }
  const batas =
    jenis === "MAP" ? indeksLini(BATAS_LINI_MAP) : DAFTAR_LINI.length - 1;
  return DAFTAR_LINI.slice(awal + 1, batas + 1);
};

// MP-2 + MP-11. Mengembalikan { lewati, berikutnya } ;
// lewati = tujuan bukan lini berikutnya (keterangan wajib, dicek pemanggil)
const periksaTransisi = (kodeAsal, kodeTujuan, jenis) => {
  getLini(kodeAsal);
  getLini(kodeTujuan);
  const boleh = daftarLiniTujuan(kodeAsal, jenis);
  if (boleh.length === 0) {
    throw galat(
      `${jenis === "MAP" ? "MAP" : "SPK"} tidak dapat dimutasi dari lini ${namaLini(kodeAsal)}`,
    );
  }
  if (!boleh.some((l) => l.kode === kodeTujuan)) {
    throw galat(
      jenis === "MAP"
        ? `MAP hanya dapat dimutasi ke lini setelah ${namaLini(kodeAsal)} sampai ${namaLini(BATAS_LINI_MAP)}`
        : `Lini tujuan harus setelah lini ${namaLini(kodeAsal)}`,
    );
  }
  return { lewati: boleh[0].kode !== kodeTujuan, berikutnya: boleh[0].nama };
};

// Apakah SPK/MAP ini sudah punya LHK di lini tersebut
const lhkAdaDiLini = async (q, kodeLini, spkNomor) => {
  const lini = getLini(kodeLini);
  if (!lini.S) {
    return false;
  }
  const [rows] = await q.query(
    `SELECT 1 FROM ${lini.S.T.dtl} WHERE ${lini.kolom.spkDtl} = ? LIMIT 1`,
    [spkNomor],
  );
  return rows.length > 0;
};

// Baris SPK itu di LHK asal (read-only, untuk expand browse dan cetak)
const ambilDetailLini = async (q, kodeLini, lhkNomor, spkNomor) => {
  const lini = getLini(kodeLini);
  if (!lini.S || !lini.detail) {
    return { Kolom: [], Baris: [] };
  }
  const [rows] = await q.query(lini.detail.buatSql(lini), [lhkNomor, spkNomor]);
  return {
    Kolom: lini.detail.kolom.map((c) => ({ Key: c.key, Label: c.label })),
    Baris: rows,
  };
};

module.exports = {
  DAFTAR_LINI,
  BATAS_LINI_MAP,
  getLini,
  getLiniAsal,
  namaLini,
  daftarLiniTujuan,
  periksaTransisi,
  lhkAdaDiLini,
  ambilDetailLini,
};
