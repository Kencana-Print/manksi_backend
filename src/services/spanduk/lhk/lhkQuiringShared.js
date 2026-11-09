const { galat, cekTutupBuku, buatPembantuLhk } = require("./lhkCommon");

const T = {
  hdr: "tlhk_quiring_hdr",
  dtl: "tlhk_quiring_dtl",
  dtl2: "tlhk_quiring_dtl_2",
  pabrik: "tpabrik",
  spk: "tspk",
  memoSpk: "tmemospk",
  karyawan: "hrd2.tkaryawan",
};

// Ejaan "CUIRING" mengikuti data HRD (kar_bagian). Ganti di sini bila HRD membetulkannya.
const BAGIAN_ABSENSI = "CUIRING";

// Cabang efektif sumber. Memo: ganti ke "mspk_cab2" kalau itu cabang pengerjaan
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
  kolomNomorHdr: "lqh_nomor",
  kolomNomorDtl: "lqd_lqh_nomor",
  kolomSpkDtl: "lqd_spk_nomor",
  tabelPemakai: TABEL_PEMAKAI_LHK,
  sqlCabSpk: SQL_CAB_SPK,
  sqlCabMemo: SQL_CAB_MEMO,
});

// LHK Quiring hanya untuk SPK (PRD): MAP/memo ditolak
const pastikanSpk = async (q, daftarNomor) => {
  const [rows] = await q.query(
    `SELECT spk_nomor FROM ${T.spk} WHERE spk_nomor IN (?)`,
    [daftarNomor],
  );
  const ada = new Set(rows.map((r) => String(r.spk_nomor).toUpperCase()));
  for (const n of daftarNomor) {
    if (!ada.has(String(n).toUpperCase())) {
      throw galat(`${n} bukan SPK. LHK Quiring hanya untuk SPK (bukan MAP)`);
    }
  }
};

module.exports = {
  T,
  BAGIAN_ABSENSI,
  galat,
  cekTutupBuku,
  filterCabang,
  pastikanLhkDiCabang,
  pastikanBelumDipakai,
  ambilInfoSpk,
  periksaSumber,
  pastikanPabrik,
  pastikanSpk,
};
