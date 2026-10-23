const { galat, adalahSuperadmin } = require("./lhkCommon");
const {
  DAFTAR_LINI,
  namaLini,
  liniBerikutnya,
  spkPunyaLhk,
  ringkasDaftar,
} = require("./lhkLini");

const TABEL_SPK = "kencanaprint.tspk";

// Pemakai di luar rantai LHK: lini -> tabel lain yang merujuk SPK/MAP-nya.
// LHK lini itu terkunci bila salah satu SPK/MAP di dalamnya ada di tabel tersebut.
const PEMAKAI_NON_LHK = {
  PROOF: {
    tabel: "kencanaprint.tkesesuaianmap",
    kolom: "mspk_nomor",
    nama: "BAST MAP",
  },
};

// Kunci mundur: LHK suatu lini tidak boleh diubah/dihapus bila salah satu
// SPK/MAP di dalamnya sudah punya LHK di lini berikutnya (pengganti MP-6/MP-14).
// Superadmin dibebaskan. Lini dikenali dari tabel + kolom nomor detail yang
// sama dengan yang dipakai buatPembantuLhk.
const pastikanTidakTerkunciRantai = async (
  q,
  { tabelDtl, kolomNomorDtl, nomor, user },
) => {
  if (adalahSuperadmin(user)) {
    return;
  }
  const lini = DAFTAR_LINI.find(
    (l) => l.S.T.dtl === tabelDtl && l.kolom.nomorDtl === kolomNomorDtl,
  );
  if (!lini) {
    return;
  }

  const [isi] = await q.query(
    `SELECT DISTINCT d.${lini.kolom.spkDtl} AS spk
     FROM ${lini.S.T.dtl} d
     WHERE d.${lini.kolom.nomorDtl} = ?${
       lini.filterDtl ? ` AND ${lini.filterDtl}` : ""
     }`,
    [nomor],
  );
  const daftar = isi.map((r) => String(r.spk).trim()).filter(Boolean);
  if (daftar.length === 0) {
    return;
  }

  // Yang ada di tspk = SPK, selebihnya MAP (sama seperti gate pembuatan)
  const [spkRows] = await q.query(
    `SELECT spk_nomor FROM ${TABEL_SPK} WHERE spk_nomor IN (?)`,
    [daftar],
  );
  const adaSpk = new Set(spkRows.map((r) => String(r.spk_nomor).toUpperCase()));

  const perBerikut = new Map();
  for (const n of daftar) {
    const berikut = liniBerikutnya(
      lini.kode,
      adaSpk.has(n.toUpperCase()) ? "SPK" : "MAP",
    );
    if (!berikut) {
      continue;
    }
    if (!perBerikut.has(berikut)) {
      perBerikut.set(berikut, []);
    }
    perBerikut.get(berikut).push(n);
  }

  for (const [kodeBerikut, daftarBerikut] of perBerikut) {
    const ada = await spkPunyaLhk(q, kodeBerikut, daftarBerikut);
    const terkunci = daftarBerikut.filter((n) => ada.has(n.toUpperCase()));
    if (terkunci.length > 0) {
      throw galat(
        `LHK ${nomor} tidak bisa diubah/dihapus: SPK/MAP ` +
          `${ringkasDaftar(terkunci)} sudah punya LHK ${namaLini(kodeBerikut)}.`,
      );
    }
  }

  const pemakai = PEMAKAI_NON_LHK[lini.kode];
  if (pemakai) {
    const [rows] = await q.query(
      `SELECT DISTINCT ${pemakai.kolom} AS nomor
       FROM ${pemakai.tabel}
       WHERE ${pemakai.kolom} IN (?)`,
      [daftar],
    );
    if (rows.length > 0) {
      throw galat(
        `LHK ${nomor} tidak bisa diubah/dihapus: MAP ` +
          `${ringkasDaftar(rows.map((r) => String(r.nomor)))} ` +
          `sudah punya ${pemakai.nama}.`,
      );
    }
  }
};

module.exports = { pastikanTidakTerkunciRantai };
