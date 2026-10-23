const { galat, TANGGAL_MULAI_MUTASI } = require("./lhkCommon");
const {
  getLini,
  namaLini,
  liniSebelumnya,
  spkPunyaLhk,
  spkSudahSelesai,
  spkLamaMp13,
  ringkasDaftar,
} = require("./lhkLini");
const { T: T_TINTA } = require("./lhkTintaShared");

const TABEL_SPK = "kencanaprint.tspk";

// LHK Proof wajib didahului LHK Tinta/Cat: MAP harus ada di salah satu LHK
// Cetak yang dirujuk LHK Tinta berisi minimal satu bahan.
const pastikanMapPunyaTinta = async (q, daftar) => {
  if (daftar.length === 0) {
    return;
  }
  const [rows] = await q.query(
    `SELECT DISTINCT TRIM(cd.lcd_spk_nomor) AS nomor
     FROM ${T_TINTA.cetakDtl} cd
     JOIN ${T_TINTA.hdr} t ON t.lnt_lch_nomor = cd.lcd_lch_nomor
     JOIN ${T_TINTA.bahan} b ON b.ltb_lnt_nomor = t.lnt_nomor
     WHERE cd.lcd_spk_nomor IN (?)`,
    [daftar],
  );
  const ada = new Set(rows.map((r) => String(r.nomor).toUpperCase()));
  const belum = daftar.filter((n) => !ada.has(n.toUpperCase()));
  if (belum.length > 0) {
    const tampil = belum.slice(0, MAKS_DAFTAR_PESAN).join(", ");
    const lebih =
      belum.length > MAKS_DAFTAR_PESAN
        ? ` dan ${belum.length - MAKS_DAFTAR_PESAN} lainnya`
        : "";
    throw galat(
      `MAP ${tampil}${lebih} belum punya LHK Tinta/Cat. ` +
        `Buat LHK Tinta/Cat terlebih dahulu.`,
    );
  }
};

// SPK/MAP hanya boleh masuk LHK suatu lini bila sudah punya LHK di lini
// tepat sebelumnya (rantai MAP dan SPK berbeda: lihat RANTAI di lhkLini).
// Dikecualikan: lini pertama rantai, dan SPK/MAP lama (MP-13).
// Dipanggil di dalam transaksi (q = koneksi). nomorLhk diisi saat ubah:
// hanya SPK/MAP yang baru ditambahkan ke LHK itu yang diperiksa.
const pastikanRantaiLhk = async (
  q,
  { kodeLini, daftarSpk, nomorLhk = null },
) => {
  const lini = getLini(kodeLini);

  let kandidat = [...new Set(daftarSpk.map((n) => String(n).trim()))].filter(
    Boolean,
  );

  if (nomorLhk) {
    const [lama] = await q.query(
      `SELECT ${lini.kolom.spkDtl} AS spk
       FROM ${lini.S.T.dtl} WHERE ${lini.kolom.nomorDtl} = ?`,
      [nomorLhk],
    );
    const adaLama = new Set(lama.map((r) => String(r.spk).toUpperCase()));
    kandidat = kandidat.filter((n) => !adaLama.has(n.toUpperCase()));
  }
  if (kandidat.length === 0) {
    return;
  }

  // Yang ada di tspk = SPK, selebihnya MAP (sumbernya sudah divalidasi form)
  const [spkRows] = await q.query(
    `SELECT spk_nomor FROM ${TABEL_SPK} WHERE spk_nomor IN (?)`,
    [kandidat],
  );
  const adaSpk = new Set(spkRows.map((r) => String(r.spk_nomor).toUpperCase()));

  // Kelompokkan per lini sebelumnya (MAP dan SPK bisa beda)
  const perLini = new Map();
  for (const n of kandidat) {
    const sebelum = liniSebelumnya(
      kodeLini,
      adaSpk.has(n.toUpperCase()) ? "SPK" : "MAP",
    );
    if (!sebelum) {
      continue;
    }
    if (!perLini.has(sebelum)) {
      perLini.set(sebelum, []);
    }
    perLini.get(sebelum).push(n);
  }
  if (perLini.size === 0) {
    return;
  }

  const lama = await spkLamaMp13(
    q,
    [...perLini.values()].flat(),
    TANGGAL_MULAI_MUTASI,
  );

  for (const [kodeSebelum, daftar] of perLini) {
    const perlu = daftar.filter((n) => !lama.has(n.toUpperCase()));
    if (perlu.length === 0) {
      continue;
    }
    const nama = namaLini(kodeSebelum);

    const ada = await spkPunyaLhk(q, kodeSebelum, perlu);
    const belum = perlu.filter((n) => !ada.has(n.toUpperCase()));
    if (belum.length > 0) {
      throw galat(
        `SPK/MAP ${ringkasDaftar(belum)} belum punya LHK ${nama}. ` +
          `Buat LHK ${nama} terlebih dahulu.`,
      );
    }

    const selesai = await spkSudahSelesai(q, kodeSebelum, perlu);
    const belumSelesai = perlu.filter((n) => !selesai.has(n.toUpperCase()));
    if (belumSelesai.length > 0) {
      throw galat(
        `LHK ${nama} untuk SPK/MAP ${ringkasDaftar(belumSelesai)} belum DONE. ` +
          `Selesaikan LHK ${nama} terlebih dahulu.`,
      );
    }
  }

  if (kodeLini === "PROOF") {
    await pastikanMapPunyaTinta(
      q,
      [...perLini.values()].flat().filter((n) => !lama.has(n.toUpperCase())),
    );
  }
};

// Gate di luar LHK (mis. BAST MAP): MAP wajib sudah punya LHK di lini tertentu.
// MAP lama (MP-13) dikecualikan, sama seperti gate rantai.
const pastikanMapPunyaLhk = async (q, { kodeLini, nomor }) => {
  const no = String(nomor).trim();
  const lama = await spkLamaMp13(q, [no], TANGGAL_MULAI_MUTASI);
  if (lama.has(no.toUpperCase())) {
    return;
  }
  const ada = await spkPunyaLhk(q, kodeLini, [no]);
  if (!ada.has(no.toUpperCase())) {
    const nama = namaLini(kodeLini);
    throw galat(
      `MAP ${no} belum punya LHK ${nama}. Buat LHK ${nama} terlebih dahulu.`,
    );
  }
};

module.exports = { pastikanRantaiLhk, pastikanMapPunyaLhk };
