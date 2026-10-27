// Klaim Kas Kecil — konstanta bersama (form, guard, Pengajuan Transfer).

// BKK baru boleh diklaim mulai tanggal ini. Untuk UAT boleh diset lebih awal
// di environment uji; WAJIB dikembalikan ke 2026-11-01 saat rilis.
const TANGGAL_MULAI_KLAIM = "2026-10-27";

// Cabang yang punya kas kecil -> rekening kas yang diisi ulang (TUJUAN klaim).
// Bank asal tidak ada di sini: dipilih Finance pusat di Pengajuan Transfer.
const REK_TUJUAN_PER_CABANG = { P04: "A-111103" };

// Bagian (token `bagian`) dengan akses penuh: lihat semua cabang,
// buat, ubah, dan batalkan klaim cabang terdaftar mana pun.
const BAGIAN_AKSES_PENUH = ["EDP", "AUDIT", "DIR"];

const aksesPenuh = (user) =>
  BAGIAN_AKSES_PENUH.includes(
    String(user?.bagian || "")
      .trim()
      .toUpperCase(),
  );

module.exports = {
  TANGGAL_MULAI_KLAIM,
  REK_TUJUAN_PER_CABANG,
  BAGIAN_AKSES_PENUH,
  aksesPenuh,
};
