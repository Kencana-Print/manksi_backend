const SUPERADMIN_BAGIAN = ["EDP", "DIR", "AUDIT"];

const bagianUser = (user) => (user?.bagian || "").toUpperCase();

const isSuperadmin = (user) => SUPERADMIN_BAGIAN.includes(bagianUser(user));

// Gudang membuat & submit dokumen QC
const bolehGudang = (user) =>
  isSuperadmin(user) || bagianUser(user).includes("GUDANG");

// Pembelian memutuskan LANJUT/REJECT/TUNDA (dipakai menu Tindak Lanjut)
const bolehPembelian = (user) =>
  isSuperadmin(user) || bagianUser(user).includes("PEMBELIAN");

const tolakHak = (res) =>
  res.status(403).json({ success: false, message: "Anda tidak punya hak." });

module.exports = { isSuperadmin, bolehGudang, bolehPembelian, tolakHak };
