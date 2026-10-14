const {
  galat,
  TANGGAL_MULAI_MUTASI,
  PEMAKAI_MUTASI_PRODUKSI,
} = require("./lhkCommon");
const { DAFTAR_LINI, namaLini } = require("../mutasiProduksiSpandukLini");

const TABEL_SPK = "kencanaprint.tspk";
const MAKS_DAFTAR_PESAN = 5;

// MP-10: LHK suatu lini hanya boleh memanggil SPK yang sudah dimutasi MASUK
// ke lini itu. Dikecualikan: lini pertama, LHK bertanggal sebelum tanggal
// mulai berlaku, MAP, dan SPK lama (MP-13). Dipanggil di dalam transaksi
// (q = koneksi). nomorLhk diisi saat ubah: hanya SPK yang baru ditambahkan
// ke LHK itu yang diperiksa.
const pastikanMutasiMasuk = async (
  q,
  { kodeLini, tanggal, daftarSpk, nomorLhk = null },
) => {
  const idx = DAFTAR_LINI.findIndex((l) => l.kode === kodeLini);
  if (idx < 0) {
    throw galat(`Lini produksi ${kodeLini} tidak dikenal`);
  }
  if (idx === 0 || tanggal < TANGGAL_MULAI_MUTASI) {
    return;
  }
  const lini = DAFTAR_LINI[idx];

  let kandidat = [...new Set(daftarSpk.map((n) => String(n).trim()))].filter(
    Boolean,
  );

  // Ubah LHK: hanya SPK yang baru ditambahkan
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

  // MAP dikecualikan: yang diperiksa hanya nomor yang ada di tspk
  const [spkRows] = await q.query(
    `SELECT spk_nomor FROM ${TABEL_SPK} WHERE spk_nomor IN (?)`,
    [kandidat],
  );
  const adaSpk = new Set(spkRows.map((r) => String(r.spk_nomor).toUpperCase()));
  kandidat = kandidat.filter((n) => adaSpk.has(n.toUpperCase()));
  if (kandidat.length === 0) {
    return;
  }

  // MP-13: SPK lama = punya LHK di lini mana pun bertanggal sebelum tanggal mulai
  const bagian = DAFTAR_LINI.filter((l) => l.S && l.kolom).map(
    (l) =>
      `SELECT d.${l.kolom.spkDtl} AS spk
       FROM ${l.S.T.dtl} d
       JOIN ${l.S.T.hdr} h ON h.${l.kolom.nomorHdr} = d.${l.kolom.nomorDtl}
       WHERE d.${l.kolom.spkDtl} IN (?) AND h.${l.kolom.tanggalHdr} < ?`,
  );
  const [lamaRows] = await q.query(
    bagian.join(" UNION "),
    bagian.flatMap(() => [kandidat, TANGGAL_MULAI_MUTASI]),
  );
  const spkLama = new Set(lamaRows.map((r) => String(r.spk).toUpperCase()));
  kandidat = kandidat.filter((n) => !spkLama.has(n.toUpperCase()));
  if (kandidat.length === 0) {
    return;
  }

  // Syarat: ada mutasi dengan tujuan lini ini. Dikunci baca agar berurutan
  // dengan hapus mutasi (yang mengunci FOR UPDATE lalu mengecek LHK tujuan).
  // MariaDB tidak mendukung "FOR SHARE": pakai LOCK IN SHARE MODE.
  const [mut] = await q.query(
    `SELECT mps_spk_nomor AS spk
     FROM ${PEMAKAI_MUTASI_PRODUKSI.tabel}
     WHERE mps_lini_tujuan = ? AND mps_spk_nomor IN (?)
     LOCK IN SHARE MODE`,
    [kodeLini, kandidat],
  );
  const sudah = new Set(mut.map((r) => String(r.spk).toUpperCase()));
  const belum = kandidat.filter((n) => !sudah.has(n.toUpperCase()));
  if (belum.length > 0) {
    const nama = namaLini(kodeLini);
    const daftar = belum.slice(0, MAKS_DAFTAR_PESAN).join(", ");
    const lebih =
      belum.length > MAKS_DAFTAR_PESAN
        ? ` dan ${belum.length - MAKS_DAFTAR_PESAN} lainnya`
        : "";
    throw galat(
      `SPK ${daftar}${lebih} belum dimutasi masuk ke lini ${nama}. ` +
        `Buat Mutasi Produksi ke ${nama} terlebih dahulu.`,
    );
  }
};

module.exports = { pastikanMutasiMasuk };
