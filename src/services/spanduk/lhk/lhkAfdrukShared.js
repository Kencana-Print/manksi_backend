const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_afdruk_hdr",
  dtl: "kencanaprint.tlhk_afdruk_dtl",
  dtl2: "kencanaprint.tlhk_afdruk_dtl_2", // Detail Plangkan: qty per ukuran per SPK
  ukuran: "kencanaprint.tms_plangkan_2", // master 15 ukuran plangkan
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
  bahan: "kencanaprint.tlhk_afdruk_bahan",
  barang: "kencanaprint.tbarang_new",
  stok: "tmasterstok_penolong",
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
