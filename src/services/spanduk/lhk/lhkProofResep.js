// Daftar bahan Resep & Actual LHK Proof (urutan = urutan di Excel rekap).
// Belum ada di master, tambahkan kodenya di sini setelah didaftarkan:
// Binder 1880, Binder 2925, ASSUCHLYR, M8, Softener, AIR
const KODE_RESEP = [
  10602, // Binder 60/70
  10632, // Regoprint
  10627, // Thickener PTF
  10619, // Emulsifier
  10604, // Black (BLACK CK)
  10608, // Blue 3787/TGN
  10643, // Yellow 3235
  10630, // Red 4406
  10626, // Pink KP
  10640, // Violet KP
  10621, // Green FBX
  10620, // Fixator
  10638, // SMT (LITER)
  10641, // Violet LK-1
  10628, // Red FFG
  10659, // Aljimat EPL
  10668, // Rubber White E-1000
];

// Obat pemakaian LHK Proof: kode master tgarmen_brg (kategori SPANDUK, jenis
// OBAT), urutan = urutan di Excel rekap. Belum ada di master (tambahkan kodenya
// di sini setelah didaftarkan): Binder 2925, ASSUCHLYR, M8, Softener.
// AIR tidak punya stok, tidak dimasukkan.
const KODE_OBAT_PROOF = [
  "S0017", // Binder 60/70
  "S0014", // Binder 1880
  "S0057", // Regoprint PT-C
  "S0050", // Thickener PTF 8287 Taxa
  "S0038", // Emulsifier
  "S0020", // Black CK
  "S0024", // Blue 3787/TGN
  "S0091", // Yellow 3235
  "S0053", // Red 4406-KP
  "S0049", // Pink KP
  "S0087", // Violet KP
  "S0040", // Green FBX
  "S0039", // Fixator
  "S0070", // SMT (LITER)
  "S0088", // Violet LK-1
  "S0054", // Red FFG-K
  "S0079", // Aljimat EPL
  "S0058", // Rubber White E-1000
];

module.exports = { KODE_RESEP, KODE_OBAT_PROOF };
