const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_proof_hdr",
  dtl: "kencanaprint.tlhk_proof_dtl",
  dtl2: "kencanaprint.tlhk_proof_dtl_2",
  ukuran: "kencanaprint.tms_plangkan_2",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
  afdrukDtl2: "kencanaprint.tlhk_afdruk_dtl_2",
  barang: "kencanaprint.tbarang_new",
  resep: "kencanaprint.tlhk_proof_resep",
};

// Proof tidak masuk rantai mutasi produksi (keputusan 16 Okt 2026)
const TABEL_PEMAKAI_LHK = [];

const {
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
} = buatPembantuLhk({
  T,
  kolomNomorHdr: "lpr_nomor",
  kolomNomorDtl: "lprd_lpr_nomor",
  kolomSpkDtl: "lprd_spk_nomor",
  tabelPemakai: TABEL_PEMAKAI_LHK,
});

module.exports = {
  T,
  galat,
  cekTutupBuku,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
};
