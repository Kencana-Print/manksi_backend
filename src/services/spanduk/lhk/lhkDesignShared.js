const {
  galat,
  teks,
  norm,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
  buatPembantuLhk,
} = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhkdesign",
  // Nomor LHK = nomor SPK/MAP (ld_spk). Header dipakai juga sebagai "dtl" untuk
  // scoping cabang, supaya LHK tanpa baris komponen tetap terlihat oleh cabangnya.
  dtl: "kencanaprint.tlhkdesign",
  komponen: "kencanaprint.tlhkdesign_komponen",
  status: "kencanaprint.tlhkdesign_status",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
};

// Tabel dipakai bersama LHK Design lain; 'P' = Proof (Spanduk)
const TIPE = "P";

// Mutasi Produksi dicabut: tidak ada modul yang merujuk LHK Design
const TABEL_PEMAKAI_LHK = [];

const {
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
} = buatPembantuLhk({
  T,
  kolomNomorHdr: "ld_spk",
  kolomNomorDtl: "ld_spk",
  kolomSpkDtl: "ld_spk",
  tabelPemakai: TABEL_PEMAKAI_LHK,
});

module.exports = {
  T,
  TIPE,
  galat,
  teks,
  norm,
  adalahSuperadmin,
  cabangUser,
  cekTutupBuku,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
};
