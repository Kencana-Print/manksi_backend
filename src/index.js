const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoute");
const lookupRoutes = require("./routes/lookupRoutes");

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

const mintaBarangRoutes = require("./routes/garmen/mintaBarangRoutes");
const mintaBarangFormRoutes = require("./routes/garmen/mintaBarangFormRoutes");
const realisasiBarangRoutes = require("./routes/garmen/realisasiBarangRoutes");
const realisasiBarangFormRoutes = require("./routes/garmen/realisasiBarangFormRoutes");

const poInternalMapRoutes = require("./routes/garmen/poInternalMapRoutes");
const poInternalMapSjRoutes = require("./routes/garmen/poInternalMapSjRoutes");
const approveSjRoutes = require("./routes/garmen/poInternalMapApproveRoutes");
const bastRoutes = require("./routes/garmen/bastRoutes");

// Penjualan Routes
const mppbRoutes = require("./routes/penjualan/mppbRoutes");
const mppbFormRoutes = require("./routes/penjualan/mppbFormRoutes");
const mintaHargaRoutes = require("./routes/penjualan/mintaHargaRoutes");
const mintaHargaFormRoutes = require("./routes/penjualan/mintaHargaFormRoutes");
const penawaranRoutes = require("./routes/penjualan/penawaranRoutes");
const penawaranFormRoutes = require("./routes/penjualan/penawaranFormRoutes");
const invoiceProformaRoutes = require("./routes/penjualan/invoiceProformaRoutes");
const invoiceProformaFormRoutes = require("./routes/penjualan/invoiceProformaFormRoutes");
const mapRoutes = require("./routes/penjualan/mapRoutes");
const mapFormRoutes = require("./routes/penjualan/mapFormRoutes");
const sjMapRoutes = require("./routes/penjualan/sjMapRoutes");
const updateSjMapRoutes = require("./routes/penjualan/updateSjMapRoutes");

const app = express();
app.use(
  cors({
    origin: [
      "http://103.94.238.252:91",
      "http://localhost:3000",
      "http://localhost:5173",
    ], // Masukkan port frontend kamu
    credentials: true,
  }),
);
app.use(express.json());
app.use("/file-gambar", express.static("/mnt/image"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/lookups", lookupRoutes);
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

app.use("/api/penjualan/mppb", mppbRoutes);
app.use("/api/penjualan/mppb/form", mppbFormRoutes);
app.use("/api/garmen/barang/permintaan", mintaBarangRoutes);
app.use("/api/garmen/barang/permintaan/form", mintaBarangFormRoutes);
app.use("/api/garmen/barang/realisasi", realisasiBarangRoutes);
app.use("/api/garmen/barang/realisasi/form", realisasiBarangFormRoutes);

app.use("/api/garmen/po-internal-map", poInternalMapRoutes);
app.use("/api/garmen/po-internal-map/surat-jalan", poInternalMapSjRoutes);
app.use("/api/garmen/po-internal-map/approve", approveSjRoutes);
app.use("/api/garmen/cetak-bast", bastRoutes);

app.use("/api/penjualan/minta-harga", mintaHargaRoutes);
app.use("/api/penjualan/minta-harga-form", mintaHargaFormRoutes);
app.use("/api/penjualan/penawaran", penawaranRoutes);
app.use("/api/penjualan/penawaran-form", penawaranFormRoutes);
app.use("/api/penjualan/invoice-proforma", invoiceProformaRoutes);
app.use("/api/penjualan/invoice-proforma/form", invoiceProformaFormRoutes);
app.use("/api/penjualan/map", mapRoutes);
app.use("/api/penjualan/map-form", mapFormRoutes);
app.use("/api/penjualan/sj-map", sjMapRoutes);
app.use("/api/penjualan/update-sj-map", updateSjMapRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server Manksi running on port ${PORT}`);
});
