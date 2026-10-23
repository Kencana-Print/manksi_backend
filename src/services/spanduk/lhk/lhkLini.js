const { galat } = require("./lhkCommon");
const design = require("./lhkDesignShared");
const afdruk = require("./lhkAfdrukShared");
const cetak = require("./lhkCetakShared");
const quiring = require("./lhkQuiringShared");
const jahit = require("./lhkJahitShared");
const lipat = require("./lhkLipatShared");
const proof = require("./lhkProofShared");

// Rantai LHK per jenis sumber. Syarat LHK = ada LHK di lini TEPAT sebelumnya.
// Lini pertama tiap rantai tanpa syarat. Lini baru (mis. Koli) cukup
// ditambahkan di sini dan di DAFTAR_LINI.
const RANTAI = {
  MAP: ["DESIGN", "AFDRUK", "CETAK", "PROOF"],
  SPK: ["CETAK", "QUIRING", "JAHIT", "LIPAT"],
};

// Modul LHK Hapus Plankan sudah dicabut (digabung ke Afdruk). Tabelnya tetap
// dibaca sebagai "setara Afdruk": MAP/SPK yang sudah punya Hapus Plankan
// dianggap memenuhi syarat lini Afdruk (gate lini berikutnya & kunci mundur),
// dan dikecualikan MP-13 bila bertanggal sebelum cutover.
const LINI_HAPUS_PLANKAN_LAMA = {
  kode: "HAPUS_PLANKAN",
  nama: "Hapus Plankan",
  S: {
    T: {
      hdr: "kencanaprint.tlhk_hapusplangkan_hdr",
      dtl: "kencanaprint.tlhk_hapusplangkan_dtl",
    },
  },
  kolom: {
    nomorHdr: "lhp_nomor",
    tanggalHdr: "lhp_tanggal",
    nomorDtl: "lhpd_lhp_nomor",
    spkDtl: "lhpd_spk_nomor",
  },
};

// filterHdr / filterDtl: tambahan WHERE (alias h = header, d = detail)
const DAFTAR_LINI = [
  {
    kode: "DESIGN",
    nama: "Design",
    S: design,
    kolom: {
      nomorHdr: "ld_spk",
      tanggalHdr: "ld_tanggal",
      nomorDtl: "ld_spk",
      spkDtl: "ld_spk",
    },
    filterHdr: "h.ld_tipe = 'P'",
    filterDtl: "d.ld_tipe = 'P'",
    // Lini ini punya status pengerjaan: lini berikutnya baru boleh dibuat
    // setelah status terakhir = nilai
    statusSelesai: {
      tabel: "kencanaprint.tlhkdesign_status",
      kolomSpk: "lds_spk",
      kolomStatus: "lds_status",
      kolomTgl: "lds_tgl",
      kolomTipe: "lds_tipe",
      tipe: "P",
      nilai: "DONE",
    },
  },
  {
    kode: "AFDRUK",
    nama: "Afdruk",
    S: afdruk,
    kolom: {
      nomorHdr: "lah_nomor",
      tanggalHdr: "lah_tanggal",
      nomorDtl: "lad_lah_nomor",
      spkDtl: "lad_spk_nomor",
    },
    setara: [LINI_HAPUS_PLANKAN_LAMA],
  },
  {
    kode: "CETAK",
    nama: "Cetak",
    S: cetak,
    kolom: {
      nomorHdr: "lch_nomor",
      tanggalHdr: "lch_tanggal",
      nomorDtl: "lcd_lch_nomor",
      spkDtl: "lcd_spk_nomor",
    },
  },
  {
    kode: "QUIRING",
    nama: "Quiring",
    S: quiring,
    kolom: {
      nomorHdr: "lqh_nomor",
      tanggalHdr: "lqh_tanggal",
      nomorDtl: "lqd_lqh_nomor",
      spkDtl: "lqd_spk_nomor",
    },
  },
  {
    kode: "JAHIT",
    nama: "Jahit",
    S: jahit,
    kolom: {
      nomorHdr: "ljh_nomor",
      tanggalHdr: "ljh_tanggal",
      nomorDtl: "ljd_ljh_nomor",
      spkDtl: "ljd_spk_nomor",
    },
  },
  {
    kode: "LIPAT",
    nama: "Lipat",
    S: lipat,
    kolom: {
      nomorHdr: "llh_nomor",
      tanggalHdr: "llh_tanggal",
      nomorDtl: "lld_llh_nomor",
      spkDtl: "lld_spk_nomor",
    },
  },
  {
    kode: "PROOF",
    nama: "Proof",
    S: proof,
    kolom: {
      nomorHdr: "lpr_nomor",
      tanggalHdr: "lpr_tanggal",
      nomorDtl: "lprd_lpr_nomor",
      spkDtl: "lprd_spk_nomor",
    },
  },
];

// Hanya untuk MP-13: modul LHK Plotter sudah dihapus, tabelnya tetap dibaca
// supaya MAP/SPK yang berjalan lewat Plotter sebelum cutover tetap dianggap lama.
const LINI_PLOTER_LAMA = {
  kode: "PLOTER",
  nama: "Plotter",
  S: {
    T: {
      hdr: "kencanaprint.tlhk_plotter_hdr",
      dtl: "kencanaprint.tlhk_plotter_dtl",
    },
  },
  kolom: {
    nomorHdr: "lph_nomor",
    tanggalHdr: "lph_tanggal",
    nomorDtl: "lpd_lph_nomor",
    spkDtl: "lpd_spk_nomor",
  },
};

const LINI_MP13 = [...DAFTAR_LINI, LINI_HAPUS_PLANKAN_LAMA, LINI_PLOTER_LAMA];

const getLini = (kode) => {
  const lini = DAFTAR_LINI.find((l) => l.kode === kode);
  if (!lini) {
    throw galat(`Lini produksi ${kode} tidak dikenal`);
  }
  return lini;
};

const namaLini = (kode) =>
  DAFTAR_LINI.find((l) => l.kode === kode)?.nama ?? kode;

// Lini tepat sebelumnya; null = lini pertama atau tidak ada di rantai jenis itu
const liniSebelumnya = (kode, jenis) => {
  const i = RANTAI[jenis].indexOf(kode);
  return i > 0 ? RANTAI[jenis][i - 1] : null;
};

// Lini tepat sesudahnya; null = lini terakhir atau tidak ada di rantai jenis itu
const liniBerikutnya = (kode, jenis) => {
  const rantai = RANTAI[jenis];
  const i = rantai.indexOf(kode);
  return i >= 0 && i < rantai.length - 1 ? rantai[i + 1] : null;
};

// Dari daftar SPK/MAP: yang status terakhirnya sudah selesai di lini tersebut.
// Lini tanpa statusSelesai dianggap selalu selesai.
// "Terakhir" = tidak ada baris status yang lebih baru (tanggal sama: dianggap selesai).
const spkSudahSelesai = async (q, kodeLini, daftar) => {
  const s = getLini(kodeLini).statusSelesai;
  if (!s) {
    return new Set(daftar.map((n) => String(n).toUpperCase()));
  }
  const [rows] = await q.query(
    `SELECT DISTINCT a.${s.kolomSpk} AS spk
     FROM ${s.tabel} a
     WHERE a.${s.kolomSpk} IN (?)
       AND a.${s.kolomTipe} = ?
       AND a.${s.kolomStatus} = ?
       AND NOT EXISTS (
         SELECT 1 FROM ${s.tabel} b
         WHERE b.${s.kolomSpk} = a.${s.kolomSpk}
           AND b.${s.kolomTipe} = ?
           AND b.${s.kolomTgl} > a.${s.kolomTgl}
       )`,
    [daftar, s.tipe, s.nilai, s.tipe],
  );
  return new Set(rows.map((r) => String(r.spk).toUpperCase()));
};

const MAKS_DAFTAR_PESAN = 5;

// "A, B, C dan 2 lainnya" untuk pesan galat
const ringkasDaftar = (daftar) => {
  const tampil = daftar.slice(0, MAKS_DAFTAR_PESAN).join(", ");
  const lebih =
    daftar.length > MAKS_DAFTAR_PESAN
      ? ` dan ${daftar.length - MAKS_DAFTAR_PESAN} lainnya`
      : "";
  return `${tampil}${lebih}`;
};

// Dari daftar SPK/MAP: yang sudah punya LHK di lini tersebut
// (termasuk tabel lini "setara", mis. Hapus Plankan lama untuk Afdruk)
const spkPunyaLhk = async (q, kodeLini, daftar) => {
  const l = getLini(kodeLini);
  const sumber = [l, ...(l.setara ?? [])];
  const bagian = sumber.map(
    (s) =>
      `SELECT d.${s.kolom.spkDtl} AS spk
       FROM ${s.S.T.dtl} d
       WHERE d.${s.kolom.spkDtl} IN (?)${s.filterDtl ? ` AND ${s.filterDtl}` : ""}`,
  );
  const [rows] = await q.query(
    bagian.join(" UNION "),
    bagian.map(() => daftar),
  );
  return new Set(rows.map((r) => String(r.spk).toUpperCase()));
};

// MP-13: SPK/MAP lama = punya LHK di lini mana pun bertanggal sebelum batas
const spkLamaMp13 = async (q, daftar, sebelumTanggal) => {
  const bagian = LINI_MP13.map(
    (l) =>
      `SELECT d.${l.kolom.spkDtl} AS spk
       FROM ${l.S.T.dtl} d
       JOIN ${l.S.T.hdr} h ON h.${l.kolom.nomorHdr} = d.${l.kolom.nomorDtl}
       WHERE d.${l.kolom.spkDtl} IN (?) AND h.${l.kolom.tanggalHdr} < ?${
         l.filterHdr ? ` AND ${l.filterHdr}` : ""
       }${l.filterDtl ? ` AND ${l.filterDtl}` : ""}`,
  );
  const [rows] = await q.query(
    bagian.join(" UNION "),
    bagian.flatMap(() => [daftar, sebelumTanggal]),
  );
  return new Set(rows.map((r) => String(r.spk).toUpperCase()));
};

module.exports = {
  RANTAI,
  DAFTAR_LINI,
  getLini,
  namaLini,
  liniSebelumnya,
  liniBerikutnya,
  spkPunyaLhk,
  spkSudahSelesai,
  spkLamaMp13,
  ringkasDaftar,
};
