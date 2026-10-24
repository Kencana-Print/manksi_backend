const {
  galat,
  cekTutupBuku,
  buatPembantuLhk,
  adalahSuperadmin,
  cabangUser,
  norm,
} = require("./lhkCommon");

const T = {
  hdr: "kencanaprint.tlhk_tinta_hdr",
  bahan: "kencanaprint.tlhk_tinta_bahan",
  cetakHdr: "kencanaprint.tlhk_cetak_hdr",
  cetakDtl: "kencanaprint.tlhk_cetak_dtl",
  barang: "kencanaprint.tbarang_new",
  pabrik: "kencanaprint.tpabrik",
  spk: "kencanaprint.tspk",
  memoSpk: "kencanaprint.tmemospk",
};

// Tinta merujuk nomor LHK Cetak (bukan per SPK/MAP), jadi cabangnya dibaca
// lewat SPK/MAP di LHK Cetak yang dirujuk. Helper berbasis detail per SPK
// (filterCabang, pastikanLhkDiCabang, pastikanBelumDipakai) tidak dipakai.
const pembantu = buatPembantuLhk({ T });

const SUMBER_CAB = `
  SELECT spk_nomor AS n, spk_cab AS c FROM ${T.spk}
  UNION ALL
  SELECT mspk_nomor, mspk_cab FROM ${T.memoSpk}`;

// Browse: hanya LHK Tinta yang LHK Cetak-nya punya SPK/MAP dari cabang user
const filterCabang = (user, alias = "h") => {
  if (adalahSuperadmin(user)) {
    return { sql: "", params: [] };
  }
  const cab = cabangUser(user);
  return {
    sql: `AND EXISTS (
      SELECT 1 FROM ${T.cetakDtl} dc
      JOIN (${SUMBER_CAB}) sc ON sc.n = dc.lcd_spk_nomor
      WHERE dc.lcd_lch_nomor = ${alias}.lnt_lch_nomor
        AND UPPER(TRIM(sc.c)) = ?
    )`,
    params: [cab],
  };
};

// LHK Tinta yang sudah ada harus berasal dari cabang user (kecuali superadmin)
const pastikanLhkDiCabang = async (q, nomor, user) => {
  if (adalahSuperadmin(user)) {
    return;
  }
  const cab = cabangUser(user);
  const [tot] = await q.query(
    `SELECT COUNT(*) AS jml
     FROM ${T.hdr} h
     JOIN ${T.cetakDtl} dc ON dc.lcd_lch_nomor = h.lnt_lch_nomor
     WHERE h.lnt_nomor = ?`,
    [nomor],
  );
  if (Number(tot[0].jml) === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT 1
     FROM ${T.hdr} h
     JOIN ${T.cetakDtl} dc ON dc.lcd_lch_nomor = h.lnt_lch_nomor
     JOIN (${SUMBER_CAB}) sc ON sc.n = dc.lcd_spk_nomor
     WHERE h.lnt_nomor = ? AND UPPER(TRIM(sc.c)) = ?
     LIMIT 1`,
    [nomor, cab],
  );
  if (rows.length === 0) {
    throw galat("LHK ini milik cabang lain", "forbidden");
  }
};

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
  filterCabang,
  pastikanLhkDiCabang,
  ambilInfoSpk: pembantu.ambilInfoSpk,
  periksaSumber: pembantu.periksaSumber,
  pastikanPabrik: pembantu.pastikanPabrik,
  pastikanTintaBelumDikunciProof,
};
