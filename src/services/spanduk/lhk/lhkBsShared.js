const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");
const { T: TQuiring, pastikanSpk } = require("./lhkQuiringShared");

const T = {
  hdr: "tlhk_bs_hdr",
  dtl: "tlhk_bs_dtl",
  spk: TQuiring.spk,
  memoSpk: TQuiring.memoSpk,
  pabrik: TQuiring.pabrik,
};

// BS tidak punya lini sesudahnya (tidak masuk rantai), jadi tanpa tabelPemakai
const {
  filterCabang,
  pastikanLhkDiCabang,
  pastikanPabrik,
  ambilInfoSpk,
  periksaSumber,
} = buatPembantuLhk({
  T,
  kolomNomorHdr: "lbh_nomor",
  kolomNomorDtl: "lbd_lbh_nomor",
  kolomSpkDtl: "lbd_spk_nomor",
});

module.exports = {
  T,
  galat,
  cekTutupBuku,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanPabrik,
  pastikanSpk,
  ambilInfoSpk,
  periksaSumber,
};
