// Klaim Kas Kecil — konstanta bersama (form, guard, Pengajuan Transfer).

// BKK baru boleh diklaim mulai tanggal ini. Untuk UAT boleh diset lebih awal
// di environment uji; WAJIB dikembalikan ke 2026-11-01 saat rilis.
const TANGGAL_MULAI_KLAIM = "2026-11-01";

// Rekening pusat pemberi dana (tujuan permintaan).
const REK_TUJUAN = "A-111101";

// Cabang yang boleh membuat klaim -> rekening kas yang diisi ulang.
// Rekening asal ditentukan dari cabang user, bukan dipilih manual.
const REK_ASAL_PER_CABANG = { P04: "A-111103" };

module.exports = { TANGGAL_MULAI_KLAIM, REK_TUJUAN, REK_ASAL_PER_CABANG };
