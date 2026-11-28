const { ambilNota } = require("./kartuHutangService");

const FORMAT_TGL = /^\d{4}-\d{2}-\d{2}$/;
const NAMA_BULAN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];
// Daftar Hutang menyaring nota menurut rentang tanggal; batas awal dibuat
// sangat lama supaya semua nota yang masih ada sisanya ikut terambil.
const TANGGAL_AWAL_SEMUA = "1900-01-01";
const TOLERANSI = 0.005;

const galat = (status, pesan) => Object.assign(new Error(pesan), { status });
const bulat = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const tentukanEndDate = (endDate) => {
  const tgl = endDate || new Date().toISOString().substring(0, 10);
  if (!FORMAT_TGL.test(tgl))
    throw galat(400, "endDate wajib berformat YYYY-MM-DD.");
  return tgl;
};

// Rekap sisa hutang per supplier, dikelompokkan ke Tahun Lalu / bulan tahun berjalan
const getRekapHutang = async ({ endDate }) => {
  const tglAkhir = tentukanEndDate(endDate);
  const tahun = tglAkhir.substring(0, 4);
  const awalTahun = `${tahun}-01-01`;

  const nota = await ambilNota(TANGGAL_AWAL_SEMUA, tglAkhir);

  const peta = new Map();
  for (const n of nota) {
    if (Math.abs(n.Sisa) <= TOLERANSI) continue;
    const baris = peta.get(n.KodeSupplier) || {
      id: n.KodeSupplier,
      Kode: n.KodeSupplier,
      Supplier: n.Supplier,
      TahunLalu: 0,
      ...Object.fromEntries(NAMA_BULAN.map((b) => [b, 0])),
      GrandTotal: 0,
    };
    const kolom =
      n.Tanggal < awalTahun
        ? "TahunLalu"
        : NAMA_BULAN[Number(n.Tanggal.substring(5, 7)) - 1];
    baris[kolom] = bulat(baris[kolom] + n.Sisa);
    baris.GrandTotal = bulat(baris.GrandTotal + n.Sisa);
    peta.set(n.KodeSupplier, baris);
  }

  return [...peta.values()]
    .filter(
      (r) =>
        Math.abs(r.GrandTotal) > TOLERANSI || Math.abs(r.TahunLalu) > TOLERANSI,
    )
    .sort(
      (a, b) =>
        b.GrandTotal - a.GrandTotal || a.Supplier.localeCompare(b.Supplier),
    );
};

const urutNota = (a, b) =>
  a.Tanggal.localeCompare(b.Tanggal) || a.Nomor.localeCompare(b.Nomor);

const ambilNotaOutstanding = async (tglAkhir) => {
  const nota = await ambilNota(TANGGAL_AWAL_SEMUA, tglAkhir);
  return nota.filter((n) => Math.abs(n.Sisa) > TOLERANSI).sort(urutNota);
};

const bentukBarisDetail = (n) => ({
  id: n.Nomor,
  KodeSupplier: n.KodeSupplier,
  Supplier: n.Supplier,
  Nomor: n.Nomor,
  Tipe: n.Tipe,
  Tanggal: n.Tanggal,
  JatuhTempo: n.JatuhTempo,
  Total: n.Total,
  Bayar: n.Bayar,
  Sisa: n.Sisa,
});

// Detail: nota yang masih ada sisanya milik satu supplier
const getDetailHutang = async ({ supKode, endDate }) => {
  const tglAkhir = tentukanEndDate(endDate);
  const kode = String(supKode || "").trim();
  if (!kode) throw galat(400, "supKode wajib diisi.");

  const nota = await ambilNotaOutstanding(tglAkhir);
  return nota.filter((n) => n.KodeSupplier === kode).map(bentukBarisDetail);
};

// Detail semua supplier sekaligus (untuk Export Detail): satu kali pemindaian
const getDetailSemuaHutang = async ({ endDate }) => {
  const tglAkhir = tentukanEndDate(endDate);
  const nota = await ambilNotaOutstanding(tglAkhir);
  return nota.map(bentukBarisDetail);
};

module.exports = { getRekapHutang, getDetailHutang, getDetailSemuaHutang };
