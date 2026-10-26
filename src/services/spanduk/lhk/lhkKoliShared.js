const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_koli_hdr",
  dtl: "kencanaprint.tlhk_koli_dtl",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
  unit: "kencanaprint.tlhk_koli_unit",
};

// Belum ada pemakai LHK (kunci rantai lewat registry lhkLini)
const TABEL_PEMAKAI_LHK = [];

const pembantu = buatPembantuLhk({
  T,
  kolomNomorHdr: "lkh_nomor",
  kolomNomorDtl: "lkd_lkh_nomor",
  kolomSpkDtl: "lkd_spk_nomor",
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
