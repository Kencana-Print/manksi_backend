const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_jahit_hdr",
  dtl: "kencanaprint.tlhk_jahit_dtl",
  dtl2: "kencanaprint.tlhk_jahit_dtl_2",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
  karyawan: "hrd2.tkaryawan",
};

const SQL_CAB_SPK = "spk_cab";
const SQL_CAB_MEMO = "mspk_cab";

// Belum ada pemakai LHK (kunci rantai LHK menunggu keputusan)
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
  kolomNomorHdr: "ljh_nomor",
  kolomNomorDtl: "ljd_ljh_nomor",
  kolomSpkDtl: "ljd_spk_nomor",
  tabelPemakai: TABEL_PEMAKAI_LHK,
  sqlCabSpk: SQL_CAB_SPK,
  sqlCabMemo: SQL_CAB_MEMO,
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
