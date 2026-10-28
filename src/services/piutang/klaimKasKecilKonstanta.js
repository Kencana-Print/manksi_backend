// Klaim Kas Kecil / Klaim ATM — konstanta bersama (form, guard, Pengajuan Transfer).

// BKK/BBK baru boleh diklaim mulai tanggal ini. Untuk UAT boleh diset lebih awal
// di environment uji; WAJIB dikembalikan ke 2026-11-01 saat rilis.
const TANGGAL_MULAI_KLAIM = "2026-10-27";

// Satu entri per akun kas yang diisi ulang lewat klaim.
//   rek    : akun kas = TUJUAN klaim (bank asal dipilih Finance di Pengajuan Transfer)
//   cabang : cabang pemilik klaim
//   sup    : supplier master yang mewakili kas itu di Pengajuan Transfer
//   jenis  : KAS_KECIL = BKK hasil penyelesaian kasbon (sumber tkasbon)
//            ATM       = BKK/BBK langsung dari jurnal (sumber tjurnal)
// Kode akun ATM harus berawalan A-112 (BBK header P01 dan BBM otomatis PJT).
const KAS_KLAIM = [
  { rek: "A-111103", cabang: "P04", sup: "S0000145", jenis: "KAS_KECIL" },
  { rek: "A-112421", cabang: "P01", sup: "S0000038", jenis: "ATM" }, // PAK JOKO
  { rek: "A-112422", cabang: "P01", sup: "S0000039", jenis: "ATM" }, // PAK RATNO
  { rek: "A-112423", cabang: "P01", sup: "S0000040", jenis: "ATM" }, // MAS ILHAM
];

const JENIS_KLAIM = ["KAS_KECIL", "ATM"];

// Cabang pusat (token cabang bisa "HO-") diperlakukan sebagai P01.
const CABANG_PUSAT = ["P01", "HO-"];
const normCabang = (c) => {
  const x = String(c || "").trim();
  return CABANG_PUSAT.includes(x) ? "P01" : x;
};

const kasByRek = (rek) => KAS_KLAIM.find((k) => k.rek === rek) || null;
const kasPerCabang = (cabang) => KAS_KLAIM.filter((k) => k.cabang === cabang);
const cabangTerdaftar = () => [...new Set(KAS_KLAIM.map((k) => k.cabang))];
const rekPerJenis = (jenis) =>
  KAS_KLAIM.filter((k) => k.jenis === jenis).map((k) => k.rek);
const semuaRekKlaim = () => KAS_KLAIM.map((k) => k.rek);
const semuaSupKlaim = () => KAS_KLAIM.map((k) => k.sup);

// Cabang klaim milik user untuk hak TULIS (buat, ubah, batal). "" bila cabang
// user tidak terdaftar. Hak BACA (browse) diatur terpisah di controller.
const cabangKlaimUser = (user) => {
  const c = normCabang(user?.cabang);
  return kasPerCabang(c).length ? c : "";
};

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
  KAS_KLAIM,
  JENIS_KLAIM,
  CABANG_PUSAT,
  BAGIAN_AKSES_PENUH,
  normCabang,
  kasByRek,
  kasPerCabang,
  cabangTerdaftar,
  rekPerJenis,
  semuaRekKlaim,
  semuaSupKlaim,
  cabangKlaimUser,
  aksesPenuh,
};
