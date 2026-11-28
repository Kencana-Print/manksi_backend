const daftarHutang = require("../finance/daftarHutangService");

const TIPE_PENGURANG = new Set(["RTG", "PJG"]); // retur & potongan jasa = mengurangi hutang
const FORMAT_TGL = /^\d{4}-\d{2}-\d{2}$/;

const galat = (status, pesan) => Object.assign(new Error(pesan), { status });
const bulat = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const cekRentang = (startDate, endDate) => {
  if (!FORMAT_TGL.test(startDate || "") || !FORMAT_TGL.test(endDate || "")) {
    throw galat(400, "startDate dan endDate wajib berformat YYYY-MM-DD.");
  }
  if (startDate > endDate) {
    throw galat(400, "Tanggal awal tidak boleh melebihi tanggal akhir.");
  }
};

// Nota dari Daftar Hutang, nilai RTG/PJG dibalik jadi negatif
const ambilNota = async (startDate, endDate) => {
  const rows = await daftarHutang.getBrowse(startDate, endDate);
  return rows.map((r) => {
    const tanda = TIPE_PENGURANG.has(r.Tipe) ? -1 : 1;
    const total = bulat(Number(r.Total) * tanda);
    const voucher = bulat(Number(r.Voucher) * tanda);
    const bayar = bulat(Number(r.Bayar) * tanda);
    return {
      Nomor: r.Nomor,
      Tipe: r.Tipe,
      Tanggal: r.Tanggal,
      JatuhTempo: r.JatuhTempo,
      KodeSupplier: String(r.SupKode || "").trim(),
      Supplier: r.Nama || "",
      Total: total,
      Voucher: voucher,
      Bayar: bayar,
      BelumVoucher: bulat(total - voucher),
      Sisa: bulat(total - bayar),
    };
  });
};

// Tingkat 1: satu baris per supplier
const getMaster = async ({
  startDate,
  endDate,
  supplier = "",
  hanyaSisa = false,
}) => {
  cekRentang(startDate, endDate);
  const nota = await ambilNota(startDate, endDate);

  const peta = new Map();
  for (const n of nota) {
    const m = peta.get(n.KodeSupplier) || {
      id: n.KodeSupplier,
      KodeSupplier: n.KodeSupplier,
      Supplier: n.Supplier,
      JmlNota: 0,
      Total: 0,
      Voucher: 0,
      Bayar: 0,
      BelumVoucher: 0,
      Sisa: 0,
    };
    m.JmlNota += 1;
    m.Total = bulat(m.Total + n.Total);
    m.Voucher = bulat(m.Voucher + n.Voucher);
    m.Bayar = bulat(m.Bayar + n.Bayar);
    m.BelumVoucher = bulat(m.BelumVoucher + n.BelumVoucher);
    m.Sisa = bulat(m.Sisa + n.Sisa);
    peta.set(n.KodeSupplier, m);
  }

  const cari = String(supplier || "")
    .trim()
    .toLowerCase();
  let hasil = [...peta.values()];
  if (cari) {
    hasil = hasil.filter(
      (m) =>
        m.KodeSupplier.toLowerCase().includes(cari) ||
        m.Supplier.toLowerCase().includes(cari),
    );
  }
  if (hanyaSisa) hasil = hasil.filter((m) => Math.abs(m.Sisa) > 0.005);
  return hasil.sort((a, b) => a.Supplier.localeCompare(b.Supplier));
};

// Tingkat 2: nota milik satu supplier
const getNota = async ({ startDate, endDate, supKode }) => {
  cekRentang(startDate, endDate);
  const kode = String(supKode || "").trim();
  if (!kode) throw galat(400, "supKode wajib diisi.");
  const nota = await ambilNota(startDate, endDate);
  return nota
    .filter((n) => n.KodeSupplier === kode)
    .map((n) => ({ id: n.Nomor, ...n }));
};

// Tingkat 3: voucher/pengajuan yang menutup satu nota
const getVoucher = async ({ startDate, endDate, nomor }) => {
  cekRentang(startDate, endDate);
  const nota = String(nomor || "").trim();
  if (!nota) throw galat(400, "nomor wajib diisi.");
  const rows = await daftarHutang.getDetail(startDate, endDate);
  return rows
    .filter((r) => String(r.Nomor).trim() === nota)
    .map((r) => ({
      id: `${r.Nomor}-${r.NomorVoucher}`,
      Nomor: r.Nomor,
      NomorVoucher: r.NomorVoucher,
      TanggalVoucher: r.TanggalVoucher,
      Total: Number(r.Total) || 0,
      StatusRealisasi: r.StatusRealisasi,
    }));
};

module.exports = { getMaster, getNota, getVoucher, ambilNota };
