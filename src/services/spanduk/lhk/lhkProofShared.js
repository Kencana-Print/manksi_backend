const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "tlhk_proof_hdr",
  dtl: "tlhk_proof_dtl",
  dtl2: "tlhk_proof_dtl_2",
  ukuran: "tms_plangkan_2",
  pabrik: "tpabrik",
  spk: "tspk",
  memoSpk: "tmemospk",
  afdrukDtl2: "tlhk_afdruk_dtl_2",
  barang: "tbarang_new",
  resep: "tlhk_proof_resep",
  garmenBrg: "tgarmen_brg",
  stokObat: "tmasterstok_obat",
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
