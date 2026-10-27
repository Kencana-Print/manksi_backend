// Daftar user dengan akses penuh (semua cabang, semua tab) di modul Uang Muka
const USER_AKSES_PENUH = ["ADMIN", "NANDA", "LIA"];

const adalahAksesPenuh = (user) =>
  USER_AKSES_PENUH.includes(String(user?.kode || "").toUpperCase());

module.exports = { USER_AKSES_PENUH, adalahAksesPenuh };
