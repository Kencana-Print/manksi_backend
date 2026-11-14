const SUPERADMIN_BAGIAN = ["EDP", "DIREKSI", "AUDIT"];

const bagianUser = (user) => (user?.bagian || "").toUpperCase();

const isSuperadmin = (user) => SUPERADMIN_BAGIAN.includes(bagianUser(user));

const CABANG_SPANDUK = "P02";

const cabangUser = (user) => (user?.cabang || "").toUpperCase();

const isUserSpanduk = (user) => cabangUser(user) === CABANG_SPANDUK;

// Gudang membuat & submit dokumen QC; di Spanduk P02 yang membuat bagian PRODUKSI
const bolehGudang = (user) =>
  isSuperadmin(user) ||
  bagianUser(user).includes("GUDANG") ||
  (isUserSpanduk(user) && bagianUser(user).includes("PRODUKSI"));

// Lingkup data QC: SEMUA | SPANDUK (PO jenis 5) | NON_SPANDUK
const lingkupQc = (user) => {
  if (isSuperadmin(user) || bagianUser(user).includes("PEMBELIAN")) {
    return "SEMUA";
  }
  return isUserSpanduk(user) ? "SPANDUK" : "NON_SPANDUK";
};

// Pembelian memutuskan LANJUT/REJECT/TUNDA (dipakai menu Tindak Lanjut)
const bolehPembelian = (user) =>
  isSuperadmin(user) || bagianUser(user).includes("PEMBELIAN");

const tolakHak = (res) =>
  res.status(403).json({ success: false, message: "Anda tidak punya hak." });

module.exports = {
  isSuperadmin,
  bolehGudang,
  lingkupQc,
  bolehPembelian,
  tolakHak,
};
