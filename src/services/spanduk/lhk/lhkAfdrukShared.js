const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "tlhk_afdruk_hdr",
  dtl: "tlhk_afdruk_dtl",
  dtl2: "tlhk_afdruk_dtl_2", // Detail Plangkan: qty per ukuran per SPK
  hpDtl2: "tlhk_hapusplangkan_dtl_2", // Plangkan dari LHK Hapus Plankan (sumber kunci)
  ukuran: "tms_plangkan_2", // master 15 ukuran plangkan
  pabrik: "tpabrik",
  spk: "tspk",
  memoSpk: "tmemospk",
  bahan: "tlhk_afdruk_bahan",
  barang: "tbarang_new",
  stok: "tmasterstok_penolong",
  garmenBrg: "tgarmen_brg",
  stokObat: "tmasterstok_obat",
  stokAcc: "tmasterstok_acc",
  stokSparepart: "tmasterstok_sparepart",
  stokAtk: "tmasterstok_atk",
};

// Belum ada pemakai LHK (kunci rantai LHK menunggu keputusan)
const TABEL_PEMAKAI_LHK = [];

const pembantu = buatPembantuLhk({
  T,
  kolomNomorHdr: "lah_nomor",
  kolomNomorDtl: "lad_lah_nomor",
  kolomSpkDtl: "lad_spk_nomor",
  tabelPemakai: TABEL_PEMAKAI_LHK,
});

module.exports = {
  T,
  galat,
  cekTutupBuku,
  filterCabang: pembantu.filterCabang,
  pastikanLhkDiCabang: pembantu.pastikanLhkDiCabang,
  pastikanBelumDipakai: pembantu.pastikanBelumDipakai,
  ambilInfoSpk: pembantu.ambilInfoSpk,
  periksaSumber: pembantu.periksaSumber,
  pastikanPabrik: pembantu.pastikanPabrik,
};
