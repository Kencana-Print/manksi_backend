const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "tlhk_plotter_hdr",
  dtl: "tlhk_plotter_dtl",
  pabrik: "tpabrik",
  spk: "tspk",
  memoSpk: "tmemospk",
};

// Belum ada pemakai LHK (kunci rantai LHK menunggu keputusan)
const TABEL_PEMAKAI_LHK = [];

const pembantu = buatPembantuLhk({
  T,
  kolomNomorHdr: "lph_nomor",
  kolomNomorDtl: "lpd_lph_nomor",
  kolomSpkDtl: "lpd_spk_nomor",
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
