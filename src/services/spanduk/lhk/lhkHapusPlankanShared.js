const {
  galat,
  cekTutupBuku,
  PEMAKAI_MUTASI_PRODUKSI,
  buatPembantuLhk,
} = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_hapusplangkan_hdr",
  dtl: "kencanaprint.tlhk_hapusplangkan_dtl",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
};

// MP-6: LHK yang sudah dimutasi tidak boleh diubah/dihapus
const TABEL_PEMAKAI_LHK = [PEMAKAI_MUTASI_PRODUKSI];

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
