const {
  galat,
  cekTutupBuku,
  buatPembantuLhk,
  adalahSuperadmin,
} = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_tinta_hdr",
  dtl: "kencanaprint.tlhk_tinta_dtl",
  dtl2: "kencanaprint.tlhk_tinta_dtl2",
  bahan: "kencanaprint.tlhk_tinta_bahan",
  cetakHdr: "kencanaprint.tlhk_cetak_hdr",
  cetakDtl: "kencanaprint.tlhk_cetak_dtl",
  barang: "kencanaprint.tbarang_new",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
};

// Belum ada pemakai LHK (kunci rantai LHK menunggu keputusan)
const TABEL_PEMAKAI_LHK = [];

const pembantu = buatPembantuLhk({
  T,
  kolomNomorHdr: "lnt_nomor",
  kolomNomorDtl: "lnd_lnt_nomor",
  kolomSpkDtl: "lnd_spk_nomor",
  tabelPemakai: TABEL_PEMAKAI_LHK,
});

// LHK Proof mewajibkan Tinta, jadi LHK Tinta tidak boleh diubah/dihapus bila
// MAP di LHK Cetak yang dirujuk sudah punya LHK Proof. Superadmin dibebaskan.
const pastikanTintaBelumDikunciProof = async (
  q,
  { nomorCetak, nomor, user },
) => {
  if (adalahSuperadmin(user)) {
    return;
  }
  const [isi] = await q.query(
    `SELECT DISTINCT TRIM(lcd_spk_nomor) AS nomor
     FROM ${T.cetakDtl} WHERE lcd_lch_nomor = ?`,
    [nomorCetak],
  );
  const daftar = isi.map((r) => String(r.nomor).trim()).filter(Boolean);
  if (daftar.length === 0) {
    return;
  }
  // require di sini: lhkLini memuat semua Shared LHK (hindari ketergantungan melingkar)
  const { spkPunyaLhk } = require("./lhkLini");
  const ada = await spkPunyaLhk(q, "PROOF", daftar);
  const terkunci = daftar.filter((n) => ada.has(n.toUpperCase()));
  if (terkunci.length > 0) {
    throw galat(
      `LHK Tinta ${nomor} tidak bisa diubah/dihapus: MAP ` +
        `${terkunci.slice(0, 5).join(", ")} sudah punya LHK Proof.`,
    );
  }
};

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
  pastikanTintaBelumDikunciProof,
};
