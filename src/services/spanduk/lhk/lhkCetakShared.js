const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "tlhk_cetak_hdr",
  dtl: "tlhk_cetak_dtl",
  dtl2: "tlhk_cetak_dtl_2",
  kain: "tlhk_cetak_kain",
  barang: "tbarang_new",
  pabrik: "tpabrik",
  spk: "tspk",
  memoSpk: "tmemospk",
  karyawan: "hrd2.tkaryawan",
};

// Kain = master bahan Spanduk, Bahan Baku Utama, jenis Bahan Baku (BB)
const KAIN = { divisi: 1, kategori: "1", jenis: "BB" };

// LHK Cetak tidak boleh diubah/dihapus selama masih dirujuk LHK Tinta/Cat
const TABEL_PEMAKAI_LHK = [
  {
    tabel: "tlhk_tinta_hdr",
    kolom: "lnt_lch_nomor",
    label: "LHK Tinta/Cat",
  },
];

const pembantu = buatPembantuLhk({
  T,
  kolomNomorHdr: "lch_nomor",
  kolomNomorDtl: "lcd_lch_nomor",
  kolomSpkDtl: "lcd_spk_nomor",
  tabelPemakai: TABEL_PEMAKAI_LHK,
});

module.exports = {
  T,
  KAIN,
  galat,
  cekTutupBuku,
  filterCabang: pembantu.filterCabang,
  pastikanLhkDiCabang: pembantu.pastikanLhkDiCabang,
  pastikanBelumDipakai: pembantu.pastikanBelumDipakai,
  ambilInfoSpk: pembantu.ambilInfoSpk,
  periksaSumber: pembantu.periksaSumber,
  pastikanPabrik: pembantu.pastikanPabrik,
};
