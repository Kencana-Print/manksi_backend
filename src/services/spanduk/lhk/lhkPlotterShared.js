const {
  galat,
  cekTutupBuku,
  PEMAKAI_MUTASI_PRODUKSI,
  buatPembantuLhk,
} = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_plotter_hdr",
  dtl: "kencanaprint.tlhk_plotter_dtl",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
};

// MP-6: LHK yang sudah dimutasi tidak boleh diubah/dihapus
const TABEL_PEMAKAI_LHK = [PEMAKAI_MUTASI_PRODUKSI];

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
