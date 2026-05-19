const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const authRoutes = require("./routes/authRoute");
const lookupRoutes = require("./routes/lookupRoutes");
const userRoutes = require("./routes/tools/userRoutes");

// ── Dashboard ──
const dashboardRoutes = require("./routes/dashboard/dashboardRoutes");

// Master Routes
const bahanRoutes = require("./routes/master/bahanRoutes");
const jenisBahanRoutes = require("./routes/master/jenisBahanRoutes");
const warnaBahanRoutes = require("./routes/master/warnaBahanRoutes");
const gramasiBahanRoutes = require("./routes/master/gramasiBahanRoutes");
const settingBahanRoutes = require("./routes/master/settingBahanRoutes");
const garmenBrgRoutes = require("./routes/master/garmenBrgRoutes");
const accesoriesRoutes = require("./routes/master/accesoriesRoutes");
const accBarangRoutes = require("./routes/master/accBarangRoutes");
const accWarnaRoutes = require("./routes/master/accWarnaRoutes");
const accUkuranRoutes = require("./routes/master/accUkuranRoutes");
const accKetRoutes = require("./routes/master/accKetRoutes");
const sparepartRoutes = require("./routes/master/sparepartRoutes");
const obatRoutes = require("./routes/master/obatRoutes");
const komponenRoutes = require("./routes/master/komponenRoutes");
const komponenSpkRoutes = require("./routes/master/komponenSpkRoutes");
const komponenSpkFormRoutes = require("./routes/master/komponenSpkFormRoutes");
const stdOutputRoutes = require("./routes/master/stdOutputRoutes");
const supplierRoutes = require("./routes/master/supplierRoutes");
const barangGarmenRoutes = require("./routes/master/barangGarmenRoutes");
const jenisBarangRoutes = require("./routes/master/jenisBarangRoutes");
const customerRoutes = require("./routes/master/customerRoutes");
const jenisOrderRoutes = require("./routes/master/jenisOrderRoutes");
const salesRoutes = require("./routes/master/salesRoutes");
const bapProduksiRoutes = require("./routes/master/bapProduksiRoutes");
const bapProduksiFormRoutes = require("./routes/master/bapProduksiFormRoutes");

// Garmen Routes
const mintaBahanRoutes = require("./routes/garmen/mintaBahanRoutes");
const realisasiBahanRoutes = require("./routes/garmen/realisasiBahanRoutes");
const realisasiBahanFormRoutes = require("./routes/garmen/realisasiBahanFormRoutes");
const returBahanRoutes = require("./routes/garmen/returBahanRoutes");
const returBahanFormRoutes = require("./routes/garmen/returBahanFormRoutes");
const approveReturBahanRoutes = require("./routes/garmen/approveReturBahanRoutes");
const approveReturBahanFormRoutes = require("./routes/garmen/approveReturBahanFormRoutes");
const bpbBahanRoutes = require("./routes/garmen/bpbBahanRoutes");
const bpbBahanFormRoutes = require("./routes/garmen/bpbBahanFormRoutes");

const mintaBarangRoutes = require("./routes/garmen/mintaBarangRoutes");
const mintaBarangFormRoutes = require("./routes/garmen/mintaBarangFormRoutes");
const realisasiBarangRoutes = require("./routes/garmen/realisasiBarangRoutes");
const realisasiBarangFormRoutes = require("./routes/garmen/realisasiBarangFormRoutes");
const permintaanPembelianRoutes = require("./routes/garmen/permintaanPembelianRoutes");
const permintaanPembelianFormRoutes = require("./routes/garmen/permintaanPembelianFormRoutes");
const mutasiOutBarangRoutes = require("./routes/garmen/mutasiOutBarangRoutes");
const mutasiOutBarangFormRoutes = require("./routes/garmen/mutasiOutBarangFormRoutes");
const mutasiInBarangRoutes = require("./routes/garmen/mutasiInBarangRoutes");
const poNonBahanRoutes = require("./routes/garmen/poNonBahanRoutes");
const poNonBahanFormRoutes = require("./routes/garmen/poNonBahanFormRoutes");
const bpbNonBahanRoutes = require("./routes/garmen/bpbNonBahanRoutes");
const bpbNonBahanFormRoutes = require("./routes/garmen/bpbNonBahanFormRoutes");

const poInternalMapRoutes = require("./routes/garmen/poInternalMapRoutes");
const poInternalMapSjRoutes = require("./routes/garmen/poInternalMapSjRoutes");
const approveSjRoutes = require("./routes/garmen/poInternalMapApproveRoutes");
const bastRoutes = require("./routes/garmen/bastRoutes");

// Pembelian Routes
const mkbRoutes = require("./routes/pembelian/mkbRoutes");
const mkbFormRoutes = require("./routes/pembelian/mkbFormRoutes");
const poBahanRoutes = require("./routes/pembelian/poBahanRoutes");
const poBahanFormRoutes = require("./routes/pembelian/poBahanFormRoutes");

// Penjualan Routes
const mppbRoutes = require("./routes/penjualan/mppbRoutes");
const mppbFormRoutes = require("./routes/penjualan/mppbFormRoutes");
const mintaHargaRoutes = require("./routes/penjualan/mintaHargaRoutes");
const mintaHargaFormRoutes = require("./routes/penjualan/mintaHargaFormRoutes");
const penawaranRoutes = require("./routes/penjualan/penawaranRoutes");
const penawaranFormRoutes = require("./routes/penjualan/penawaranFormRoutes");
const salesOrderRoutes = require("./routes/penjualan/salesOrderRoutes");
const salesOrderFormRoutes = require("./routes/penjualan/salesOrderFormRoutes");
const invoiceProformaRoutes = require("./routes/penjualan/invoiceProformaRoutes");
const invoiceProformaFormRoutes = require("./routes/penjualan/invoiceProformaFormRoutes");
const mapRoutes = require("./routes/penjualan/mapRoutes");
const mapFormRoutes = require("./routes/penjualan/mapFormRoutes");
const sjMapRoutes = require("./routes/penjualan/sjMapRoutes");
const updateSjMapRoutes = require("./routes/penjualan/updateSjMapRoutes");

//Laporan Routes
const poBahanVsMkbRoutes = require("./routes/laporan/gudang-garmen/poBahanVsMkbRoutes");
const poBahanVsBpbRoutes = require("./routes/laporan/gudang-garmen/poBahanVsBpbRoutes");

const penawaranVsSpkRoutes = require("./routes/laporan/penjualan/penawaranVsSpkRoutes");
const realisasiPenawaranRoutes = require("./routes/laporan/penjualan/realisasiPenawaranRoutes");

const app = express();
// KONFIGURASI CORS SUPER AMAN & ANTI WILDCARD
app.use(
  cors({
    origin: function (origin, callback) {
      // Jika tidak ada origin (misal via curl/postman), izinkan saja
      if (!origin) return callback(null, true);

      // Izinkan SEMUA origin dengan menggemakan kembali origin yang me-request.
      // Ini memastikan header 'Access-Control-Allow-Origin' SELALU berisi URL spesifik, bukan '*'.
      callback(null, origin);
    },
    credentials: true, // Wajib di-set true jika frontend mengirim cookie/token
  }),
);

app.use(express.json());
app.use("/file-gambar", express.static("/mnt/image"));
app.use("/images", express.static(path.join(process.cwd(), "public/images")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/lookups", lookupRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/tools/users", userRoutes);

app.use("/api/master/bahan", bahanRoutes);
app.use("/api/master/jenis-bahan", jenisBahanRoutes);
app.use("/api/master/warna-bahan", warnaBahanRoutes);
app.use("/api/master/gramasi", gramasiBahanRoutes);
app.use("/api/master/setting", settingBahanRoutes);
app.use("/api/master/barang-garmen", garmenBrgRoutes);
app.use("/api/master/accesories", accesoriesRoutes);
app.use("/api/master/acc-barang", accBarangRoutes);
app.use("/api/master/acc-warna", accWarnaRoutes);
app.use("/api/master/acc-ukuran", accUkuranRoutes);
app.use("/api/master/acc-keterangan", accKetRoutes);
app.use("/api/master/sparepart", sparepartRoutes);
app.use("/api/master/obat", obatRoutes);
app.use("/api/master/komponen", komponenRoutes);
app.use("/api/master/komponen-spk", komponenSpkRoutes);
app.use("/api/master/komponen-spk-form", komponenSpkFormRoutes);
app.use("/api/master/standart-output", stdOutputRoutes);
app.use("/api/master/supplier", supplierRoutes);
app.use("/api/master/barang", barangGarmenRoutes);
app.use("/api/master/jenis-barang", jenisBarangRoutes);
app.use("/api/master/customer", customerRoutes);
app.use("/api/master/jenis-order", jenisOrderRoutes);
app.use("/api/master/sales", salesRoutes);
app.use("/api/master/bap-produksi", bapProduksiRoutes);
app.use("/api/master/bap-produksi-form", bapProduksiFormRoutes);

app.use("/api/pembelian/mkb/form", mkbFormRoutes);
app.use("/api/pembelian/mkb", mkbRoutes);
app.use("/api/pembelian/po-bahan", poBahanRoutes);
app.use("/api/pembelian/po-bahan/form", poBahanFormRoutes);

app.use("/api/garmen/bahan-baku/minta-bahan", mintaBahanRoutes);
app.use("/api/garmen/bahan-baku/realisasi-minta", realisasiBahanRoutes);
app.use(
  "/api/garmen/bahan-baku/realisasi-minta-form",
  realisasiBahanFormRoutes,
);
app.use("/api/garmen/bahan-baku/retur-bahan", returBahanRoutes);
app.use("/api/garmen/bahan-baku/retur-bahan/form", returBahanFormRoutes);
app.use("/api/garmen/bahan-baku/approve-retur", approveReturBahanRoutes);
app.use(
  "/api/garmen/bahan-baku/approve-retur/form",
  approveReturBahanFormRoutes,
);
app.use("/api/garmen/bahan-baku/bpb-bahan", bpbBahanRoutes);
app.use("/api/garmen/bahan-baku/bpb-bahan/form", bpbBahanFormRoutes);

app.use("/api/garmen/barang/permintaan", mintaBarangRoutes);
app.use("/api/garmen/barang/permintaan/form", mintaBarangFormRoutes);
app.use("/api/garmen/barang/realisasi", realisasiBarangRoutes);
app.use("/api/garmen/barang/realisasi/form", realisasiBarangFormRoutes);
app.use("/api/garmen/barang/permintaan-pembelian", permintaanPembelianRoutes);
app.use(
  "/api/garmen/barang/permintaan-pembelian/form",
  permintaanPembelianFormRoutes,
);
app.use("/api/garmen/barang/mutasi-out", mutasiOutBarangRoutes);
app.use("/api/garmen/barang/mutasi-out/form", mutasiOutBarangFormRoutes);
app.use("/api/garmen/barang/mutasi-in", mutasiInBarangRoutes);
app.use("/api/garmen/barang/po-nonbahan", poNonBahanRoutes);
app.use("/api/garmen/barang/po-nonbahan-form", poNonBahanFormRoutes);
app.use("/api/garmen/barang/bpb-nonbahan", bpbNonBahanRoutes);
app.use("/api/garmen/barang/bpb-nonbahan/form", bpbNonBahanFormRoutes);

app.use("/api/garmen/po-internal-map", poInternalMapRoutes);
app.use("/api/garmen/po-internal-map/surat-jalan", poInternalMapSjRoutes);
app.use("/api/garmen/po-internal-map/approve", approveSjRoutes);
app.use("/api/garmen/cetak-bast", bastRoutes);

app.use("/api/penjualan/mppb", mppbRoutes);
app.use("/api/penjualan/mppb/form", mppbFormRoutes);
app.use("/api/penjualan/minta-harga", mintaHargaRoutes);
app.use("/api/penjualan/minta-harga-form", mintaHargaFormRoutes);
app.use("/api/penjualan/penawaran", penawaranRoutes);
app.use("/api/penjualan/penawaran-form", penawaranFormRoutes);
app.use("/api/penjualan/invoice-proforma", invoiceProformaRoutes);
app.use("/api/penjualan/invoice-proforma/form", invoiceProformaFormRoutes);
app.use("/api/penjualan/sales-order", salesOrderRoutes);
app.use("/api/penjualan/sales-order/form", salesOrderFormRoutes);
app.use("/api/penjualan/map", mapRoutes);
app.use("/api/penjualan/map-form", mapFormRoutes);
app.use("/api/penjualan/sj-map", sjMapRoutes);
app.use("/api/penjualan/update-sj-map", updateSjMapRoutes);

app.use("/api/laporan/gudang-garmen/po-bahan-vs-mkb", poBahanVsMkbRoutes);
app.use("/api/laporan/gudang-garmen/po-bahan-vs-bpb", poBahanVsBpbRoutes);
app.use("/api/laporan/penjualan/penawaran-vs-spk", penawaranVsSpkRoutes);
app.use("/api/laporan/penjualan/realisasi-penawaran", realisasiPenawaranRoutes);

const PORT = process.env.PORT || 3088;
app.listen(PORT, () => {
  console.log(`Server Manksi running on port ${PORT}`);
});
