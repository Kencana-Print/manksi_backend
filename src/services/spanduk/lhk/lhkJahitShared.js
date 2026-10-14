const {
  galat,
  cekTutupBuku,
  buatPembantuLhk,
  PEMAKAI_MUTASI_PRODUKSI,
} = require("./lhkCommon");

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

// MP-6: LHK yang sudah dimutasi tidak boleh diubah/dihapus
const TABEL_PEMAKAI_LHK = [PEMAKAI_MUTASI_PRODUKSI];

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
