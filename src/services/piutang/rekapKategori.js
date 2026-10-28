// Kategori = label tipe nota (label sama dengan form Voucher). Satu tempat.
// RET, PJG, POE belum ada di list user: label sementara.
const KATEGORI_TIPE = {
  BPB: "BPB Bahan",
  BPJ: "BPB Jasa",
  MMT: "BPB MMT",
  BPE: "BPB PO Ext MMT",
  BPG: "BPB Non Bahan",
  POL: "PO Lain-lain",
  POB: "PO Bahan/Greige/Celup",
  POE: "PO External",
  RET: "Retur Barang",
  PJG: "Potongan Jasa",
};

const URUTAN = Object.keys(KATEGORI_TIPE);

const kategoriDari = (tipe) => KATEGORI_TIPE[tipe] || tipe;

const urutanKategori = (tipe) => {
  const i = URUTAN.indexOf(tipe);
  return i === -1 ? URUTAN.length : i;
};

module.exports = { KATEGORI_TIPE, kategoriDari, urutanKategori };
