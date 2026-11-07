const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "tlhk_hapusplangkan_hdr",
  dtl: "tlhk_hapusplangkan_dtl",
  dtl2: "tlhk_hapusplangkan_dtl_2",
  ukuran: "tms_plangkan_2",
  pabrik: "tpabrik",
  spk: "tspk",
  memoSpk: "tmemospk",
};

// Belum ada pemakai LHK (kunci rantai LHK menunggu keputusan)
const TABEL_PEMAKAI_LHK = [];

const pembantu = buatPembantuLhk({
  T,
  kolomNomorHdr: "lhp_nomor",
  kolomNomorDtl: "lhpd_lhp_nomor",
  kolomSpkDtl: "lhpd_spk_nomor",
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
