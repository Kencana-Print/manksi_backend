const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const authRoutes = require("./routes/authRoute");
const lookupRoutes = require("./routes/lookupRoutes");

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

// PPIC Routes
const proofRoutes = require("./routes/ppic/proofRoutes");
const proofFormRoutes = require("./routes/ppic/proofFormRoutes");
const bastRoutes = require("./routes/garmen/bastRoutes");
const spkPpicRoutes = require("./routes/ppic/spkRoutes");
const spkPpicFormRoutes = require("./routes/ppic/spkFormRoutes");
const planningSpkRoutes = require("./routes/ppic/planningSpkRoutes");
const planningSpkFormRoutes = require("./routes/ppic/planningSpkFormRoutes");

// Garmen Routes
const mintaBahanRoutes = require("./routes/garmen/mintaBahanRoutes");
const realisasiBahanRoutes = require("./routes/garmen/realisasiBahanRoutes");
const realisasiBahanFormRoutes = require("./routes/garmen/realisasiBahanFormRoutes");
const returBahanRoutes = require("./routes/garmen/returBahanRoutes");
const returBahanFormRoutes = require("./routes/garmen/returBahanFormRoutes");
const approveReturBahanRoutes = require("./routes/garmen/approveReturBahanRoutes");
const approveReturBahanFormRoutes = require("./routes/garmen/approveReturBahanFormRoutes");
const koreksiStokBahanRoutes = require("./routes/garmen/koreksiStokBahanRoutes");
const koreksiStokBahanFormRoutes = require("./routes/garmen/koreksiStokBahanFormRoutes");
const bpbBahanRoutes = require("./routes/garmen/bpbBahanRoutes");
const bpbBahanFormRoutes = require("./routes/garmen/bpbBahanFormRoutes");
const returBeliBahanRoutes = require("./routes/garmen/returBeliBahanRoutes");
const returBeliBahanFormRoutes = require("./routes/garmen/returBeliBahanFormRoutes");
const pembuatanBarcodeBahanRoutes = require("./routes/garmen/pembuatanBarcodeBahanRoutes");
const pembuatanBarcodeBahanFormRoutes = require("./routes/garmen/pembuatanBarcodeBahanFormRoutes");

const stbjRoutes = require("./routes/garmen/stbjRoutes");
const stbjFormRoutes = require("./routes/garmen/stbjFormRoutes");

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

const poJasaRoutes = require("./routes/garmen/poJasaRoutes");
const poJasaFormRoutes = require("./routes/garmen/poJasaFormRoutes");
const approvePoJasaRoutes = require("./routes/garmen/approvePoJasaRoutes");
const bpbJasaRoutes = require("./routes/garmen/bpbJasaRoutes");
const bpbJasaFormRoutes = require("./routes/garmen/bpbJasaFormRoutes");

const mkaGarmenRoutes = require("./routes/garmen/mkaRoutes");
const mkaFormRoutes = require("./routes/garmen/mkaFormRoutes");

const poInternalMapRoutes = require("./routes/garmen/poInternalMapRoutes");
const poInternalMapSjRoutes = require("./routes/garmen/poInternalMapSjRoutes");
const approveSjRoutes = require("./routes/garmen/poInternalMapApproveRoutes");
const poInternalSpkRoutes = require("./routes/garmen/poInternalSpkRoutes");
const poInternalSpkFormRoutes = require("./routes/garmen/poInternalSpkFormRoutes");
const sjPoInternalSpkRoutes = require("./routes/garmen/sjPoInternalSpkRoutes");
const sjPoInternalSpkFormRoutes = require("./routes/garmen/sjPoInternalSpkFormRoutes");
const approvePoInternalSpkRoutes = require("./routes/garmen/approvePoInternalSpkRoutes");
const approvePoInternalSpkFormRoutes = require("./routes/garmen/approvePoInternalSpkFormRoutes");

const mutasiProduksiRoutes = require("./routes/garmen/mutasiProduksiRoutes");
const mutasiProduksiFormRoutes = require("./routes/garmen/mutasiProduksiFormRoutes");

const lhkPolaRoutes = require("./routes/garmen/lhkPolaRoutes");
const lhkPolaFormRoutes = require("./routes/garmen/lhkPolaFormRoutes");

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
const praSuratJalanRoutes = require("./routes/penjualan/praSuratJalanRoutes");
const praSuratJalanFormRoutes = require("./routes/penjualan/praSuratJalanFormRoutes");
const suratJalanRoutes = require("./routes/penjualan/suratJalanRoutes");
const sjFormRoutes = require("./routes/penjualan/suratJalanFormRoutes");
const sjTakNormalRoutes = require("./routes/penjualan/sjTakNormalRoutes");
const sjTakNormalFormRoutes = require("./routes/penjualan/sjTakNormalFormRoutes");
const updateStatusSjRoutes = require("./routes/penjualan/updateStatusSjRoutes");
const approvalSjRoutes = require("./routes/penjualan/approvalSjRoutes");
const invoiceRoutes = require("./routes/penjualan/invoiceRoutes");
const invoiceFormRoutes = require("./routes/penjualan/invoiceFormRoutes");
const invoiceProformaRoutes = require("./routes/penjualan/invoiceProformaRoutes");
const invoiceProformaFormRoutes = require("./routes/penjualan/invoiceProformaFormRoutes");
const invoiceTakNormalRoutes = require("./routes/penjualan/invoiceTakNormalRoutes");
const invoiceTakNormalFormRoutes = require("./routes/penjualan/invoiceTakNormalFormRoutes");
const cetakKuitansiRoutes = require("./routes/penjualan/cetakKuitansiRoutes");
const cetakFakturPajakRoutes = require("./routes/penjualan/cetakFakturPajakRoutes");
const exportCsvPajakRoutes = require("./routes/penjualan/exportCsvPajakRoutes");
const mapRoutes = require("./routes/penjualan/mapRoutes");
const mapFormRoutes = require("./routes/penjualan/mapFormRoutes");
const sjMapRoutes = require("./routes/penjualan/sjMapRoutes");
const updateSjMapRoutes = require("./routes/penjualan/updateSjMapRoutes");
const jadwalKirimRoutes = require("./routes/penjualan/jadwalKirimRoutes");
const jadwalKirimFormRoutes = require("./routes/penjualan/jadwalKirimFormRoutes");

//Piutang Routes
const giroRoutes = require("./routes/piutang/penerimaan/giroRoutes");
const giroFormRoutes = require("./routes/piutang/penerimaan/giroFormRoutes");
const cashRoutes = require("./routes/piutang/penerimaan/cashRoutes");
const cashFormRoutes = require("./routes/piutang/penerimaan/cashFormRoutes");
const transferRoutes = require("./routes/piutang/penerimaan/transferRoutes");
const transferFormRoutes = require("./routes/piutang/penerimaan/transferFormRoutes");
const potonganRoutes = require("./routes/piutang/penerimaan/potonganRoutes");
const potonganFormRoutes = require("./routes/piutang/penerimaan/potonganFormRoutes");
const pelunasanPiutangRoutes = require("./routes/piutang/pelunasanRoutes");
const pelunasanFormRoutes = require("./routes/piutang/pelunasanFormRoutes");

//Laporan Routes
//Laporan Gudang Garmen
const lapStokBahanBarcodeRoutes = require("./routes/laporan/gudang-garmen/laporanStokBahanBarcodeRoutes");
const kartuStokBahanRoutes = require("./routes/laporan/gudang-garmen/kartuStokBahanRoutes");
const kartuStokBarangRoutes = require("./routes/laporan/gudang-garmen/kartuStokGarmenRoutes");
const mutasiStokBahanRoutes = require("./routes/laporan/gudang-garmen/mutasiStokBahanRoutes");
const stokAccVsMkaRoutes = require("./routes/laporan/gudang-garmen/stokAccVsMkaRoutes");
const stokDcRoutes = require("./routes/laporan/gudang-garmen/stokDcRoutes");
const stokBarangJadiRoutes = require("./routes/laporan/gudang-garmen/stokBarangJadiRoutes");
const kartuStokBarangJadiRoutes = require("./routes/laporan/gudang-garmen/kartuStokBarangJadiRoutes");
const mutasiStokBarangJadiRoutes = require("./routes/laporan/gudang-garmen/mutasiStokBarangJadiRoutes");
const standartBabaranVsRealisasiRoutes = require("./routes/laporan/gudang-garmen/standartBabaranVsRealisasiRoutes");
const spkBelumMkbRoutes = require("./routes/laporan/gudang-garmen/spkBelumMkbRoutes");
const poBahanVsMkbRoutes = require("./routes/laporan/gudang-garmen/poBahanVsMkbRoutes");
const poBahanVsBpbRoutes = require("./routes/laporan/gudang-garmen/poBahanVsBpbRoutes");
const pojVsBpjRoutes = require("./routes/laporan/gudang-garmen/pojVsBpjRoutes");
const outstandingPoMitraRoutes = require("./routes/laporan/gudang-garmen/outstandingPoMitraRoutes");
const realisasiMintaBahanRoutes = require("./routes/laporan/gudang-garmen/realisasiMintaBahanRoutes");
const realisasiMintaVsLhkCuttRoutes = require("./routes/laporan/gudang-garmen/realisasiMintaVsLhkCuttRoutes");
const spkDtfBelumPoRoutes = require("./routes/laporan/gudang-garmen/spkDtfBelumPoRoutes");
const spkVsRealisasiVsLhkCuttRoutes = require("./routes/laporan/gudang-garmen/spkVsRealisasiVsLhkCuttRoutes");
const spkVsStbjVsSjRoutes = require("./routes/laporan/gudang-garmen/spkVsStbjVsSjRoutes");
const spkMkbVsPoBpbRoutes = require("./routes/laporan/gudang-garmen/spkMkbVsPoBpbRoutes");
const spkVsPoRoutes = require("./routes/laporan/gudang-garmen/spkVsPoRoutes");
const spkVsBpbRoutes = require("./routes/laporan/gudang-garmen/spkVsBpbRoutes");
const spkVsBpbNonPoRoutes = require("./routes/laporan/gudang-garmen/spkVsBpbNonPoRoutes");
const spkCloseStbjRoutes = require("./routes/laporan/gudang-garmen/spkCloseStbjRoutes");
const laporanMutasiProduksiRoutes = require("./routes/laporan/gudang-garmen/laporanMutasiProduksiRoutes");
const laporanKekuranganProduksiRoutes = require("./routes/laporan/gudang-garmen/laporanKekuranganProduksiRoutes");
const laporanOutstandingSpkRoutes = require("./routes/laporan/gudang-garmen/laporanOutstandingSpkRoutes");
const browseSpkRoutes = require("./routes/laporan/gudang-garmen/browseSpkRoutes");
const browseMapRoutes = require("./routes/laporan/gudang-garmen/browseMapRoutes");

// Laporan Produksi Garmen
const monitoringProduksiRoutes = require("./routes/laporan/produksi-garmen/monitoringProduksiRoutes");
const monitoringKekuranganProduksiRoutes = require("./routes/laporan/produksi-garmen/monitoringKekuranganProduksiRoutes");
const monitoringKekuranganProduksiJahitRoutes = require("./routes/laporan/produksi-garmen/monitoringKekuranganProduksiJahitRoutes");
const monitoringKekuranganProduksiV2Routes = require("./routes/laporan/produksi-garmen/monitoringKekuranganProduksiV2Routes");
const monitoringKedatanganBahanRoutes = require("./routes/laporan/produksi-garmen/monitoringKedatanganBahanRoutes");
const monitoringBsRoutes = require("./routes/laporan/produksi-garmen/monitoringBsRoutes");
const stokProduksibyLineRoutes = require("./routes/laporan/produksi-garmen/stokProduksibyLineRoutes");
const outstandingBordirRoutes = require("./routes/laporan/produksi-garmen/outstandingBordirRoutes");
const laporanPemakaianObatRoutes = require("./routes/laporan/produksi-garmen/laporanPemakaianObatRoutes");

// Laporan Penjualan
const penawaranVsSpkRoutes = require("./routes/laporan/penjualan/penawaranVsSpkRoutes");
const realisasiPenawaranRoutes = require("./routes/laporan/penjualan/realisasiPenawaranRoutes");
const spkVsStbjRoutes = require("./routes/laporan/penjualan/spkVsStbjRoutes");
const spkVsSjRoutes = require("./routes/laporan/penjualan/spkVsSjRoutes");
const spkVsSjVsInvRoutes = require("./routes/laporan/penjualan/spkVsSjVsInvRoutes");
const mapVsSjRoutes = require("./routes/laporan/penjualan/mapVsSjRoutes");
const mapVsSpkRoutes = require("./routes/laporan/penjualan/mapVsSpkRoutes");

// Laporan Marketing
const penawaranVsMapRoutes = require("./routes/laporan/marketing/penawaranVsMapRoutes");
const mapBelumRealisasiRoutes = require("./routes/laporan/marketing/mapBelumRealisasiRoutes");
const spkBelumClosingRoutes = require("./routes/laporan/marketing/spkBelumClosingRoutes");
const realisasiPenjualanRoutes = require("./routes/laporan/marketing/realisasiPenjualanRoutes");
const rekapMapRoutes = require("./routes/laporan/marketing/rekapMapRoutes");
const rekapPenawaranRoutes = require("./routes/laporan/marketing/rekapPenawaranRoutes");
const kunjunganSalesRoutes = require("./routes/laporan/marketing/kunjunganSalesRoutes");

// Laporan Piutang
const detailPiutangRoutes = require("./routes/laporan/piutang/detailPiutangRoutes");
const rekapPiutangRoutes = require("./routes/laporan/piutang/rekapPiutangRoutes");
const kartuPiutangRoutes = require("./routes/laporan/piutang/kartuPiutangRoutes");
const daftarPenerimaanRoutes = require("./routes/laporan/piutang/daftarPenerimaanRoutes");
const cekGagalLinkRoutes = require("./routes/laporan/piutang/cekGagalLinkRoutes");

// Tools Routes
const userRoutes = require("./routes/tools/userRoutes");
const userFormRoutes = require("./routes/tools/userFormRoutes");
const approvalRoutes = require("./routes/tools/approvalRoutes");

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

app.use("/api/ppic/proof", proofRoutes);
app.use("/api/ppic/proof-form", proofFormRoutes);
app.use("/api/garmen/cetak-bast", bastRoutes);
app.use("/api/ppic/spk", spkPpicRoutes);
app.use("/api/ppic/spk/form", spkPpicFormRoutes);
app.use("/api/ppic/planning-spk", planningSpkRoutes);
app.use("/api/ppic/planning-spk-form", planningSpkFormRoutes);

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
app.use("/api/garmen/bahan-baku/koreksi-stok", koreksiStokBahanRoutes);
app.use("/api/garmen/bahan-baku/koreksi-stok/form", koreksiStokBahanFormRoutes);
app.use("/api/garmen/bahan-baku/bpb-bahan", bpbBahanRoutes);
app.use("/api/garmen/bahan-baku/bpb-bahan/form", bpbBahanFormRoutes);
app.use("/api/garmen/bahan-baku/retur-pembelian-bahan", returBeliBahanRoutes);
app.use(
  "/api/garmen/bahan-baku/retur-pembelian-bahan/form",
  returBeliBahanFormRoutes,
);
app.use(
  "/api/garmen/bahan-baku/pembuatan-barcode-bahan",
  pembuatanBarcodeBahanRoutes,
);
app.use(
  "/api/garmen/bahan-baku/pembuatan-barcode-bahan/form",
  pembuatanBarcodeBahanFormRoutes,
);

app.use("/api/garmen/stbj", stbjRoutes);
app.use("/api/garmen/stbj-form", stbjFormRoutes);

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

app.use("/api/garmen/po-jasa", poJasaRoutes);
app.use("/api/garmen/po-jasa-form", poJasaFormRoutes);
app.use("/api/garmen/approve-po-jasa", approvePoJasaRoutes);
app.use("/api/garmen/bpb-jasa", bpbJasaRoutes);
app.use("/api/garmen/bpb-jasa-form", bpbJasaFormRoutes);

app.use("/api/garmen/mka", mkaGarmenRoutes);
app.use("/api/garmen/mka-form", mkaFormRoutes);

app.use("/api/garmen/po-internal-map", poInternalMapRoutes);
app.use("/api/garmen/po-internal-map/surat-jalan", poInternalMapSjRoutes);
app.use("/api/garmen/po-internal-map/approve", approveSjRoutes);
app.use("/api/garmen/po-internal-spk/po-internal", poInternalSpkRoutes);
app.use(
  "/api/garmen/po-internal-spk/po-internal-form",
  poInternalSpkFormRoutes,
);
app.use("/api/garmen/po-internal-spk/sj-po-internal", sjPoInternalSpkRoutes);
app.use(
  "/api/garmen/po-internal-spk/sj-po-internal-form",
  sjPoInternalSpkFormRoutes,
);
app.use("/api/garmen/po-internal-spk/approve-sj", approvePoInternalSpkRoutes);
app.use(
  "/api/garmen/po-internal-spk/approve-sj-form",
  approvePoInternalSpkFormRoutes,
);

app.use("/api/garmen/mutasi-produksi", mutasiProduksiRoutes);
app.use("/api/garmen/mutasi-produksi-form", mutasiProduksiFormRoutes);

app.use("/api/garmen/lhk-pola", lhkPolaRoutes);
app.use("/api/garmen/lhk-pola-form", lhkPolaFormRoutes);

app.use("/api/penjualan/mppb", mppbRoutes);
app.use("/api/penjualan/mppb/form", mppbFormRoutes);
app.use("/api/penjualan/minta-harga", mintaHargaRoutes);
app.use("/api/penjualan/minta-harga-form", mintaHargaFormRoutes);
app.use("/api/penjualan/penawaran", penawaranRoutes);
app.use("/api/penjualan/penawaran-form", penawaranFormRoutes);
app.use("/api/penjualan/sales-order", salesOrderRoutes);
app.use("/api/penjualan/sales-order/form", salesOrderFormRoutes);
app.use("/api/penjualan/pra-sj", praSuratJalanRoutes);
app.use("/api/penjualan/pra-sj-form", praSuratJalanFormRoutes);
app.use("/api/penjualan/surat-jalan", suratJalanRoutes);
app.use("/api/penjualan/surat-jalan-form", sjFormRoutes);
app.use("/api/penjualan/sj-tak-normal", sjTakNormalRoutes);
app.use("/api/penjualan/sj-tak-normal-form", sjTakNormalFormRoutes);
app.use("/api/penjualan/update-status-sj", updateStatusSjRoutes);
app.use("/api/penjualan/approval-sj", approvalSjRoutes);
app.use("/api/penjualan/invoice", invoiceRoutes);
app.use("/api/penjualan/invoice-form", invoiceFormRoutes);
app.use("/api/penjualan/invoice-proforma", invoiceProformaRoutes);
app.use("/api/penjualan/invoice-proforma/form", invoiceProformaFormRoutes);
app.use("/api/penjualan/invoice-tak-normal", invoiceTakNormalRoutes);
app.use("/api/penjualan/invoice-tak-normal-form", invoiceTakNormalFormRoutes);
app.use("/api/penjualan/cetak-kuitansi", cetakKuitansiRoutes);
app.use("/api/penjualan/cetak-faktur-pajak", cetakFakturPajakRoutes);
app.use("/api/penjualan/export-csv-pajak", exportCsvPajakRoutes);
app.use("/api/penjualan/map", mapRoutes);
app.use("/api/penjualan/map-form", mapFormRoutes);
app.use("/api/penjualan/sj-map", sjMapRoutes);
app.use("/api/penjualan/update-sj-map", updateSjMapRoutes);
app.use("/api/penjualan/jadwal-kirim", jadwalKirimRoutes);
app.use("/api/penjualan/jadwal-kirim-form", jadwalKirimFormRoutes);

app.use("/api/piutang/penerimaan/giro", giroRoutes);
app.use("/api/piutang/penerimaan/giro-form", giroFormRoutes);
app.use("/api/piutang/penerimaan/cash", cashRoutes);
app.use("/api/piutang/penerimaan/cash-form", cashFormRoutes);
app.use("/api/piutang/penerimaan/transfer", transferRoutes);
app.use("/api/piutang/penerimaan/transfer-form", transferFormRoutes);
app.use("/api/piutang/penerimaan/potongan", potonganRoutes);
app.use("/api/piutang/penerimaan/potongan-form", potonganFormRoutes);
app.use("/api/piutang/pelunasan", pelunasanPiutangRoutes);
app.use("/api/piutang/pelunasan-form", pelunasanFormRoutes);

app.use(
  "/api/laporan/gudang-garmen/stok-bahan-barcode",
  lapStokBahanBarcodeRoutes,
);
app.use("/api/laporan/gudang-garmen/kartu-stok-bahan", kartuStokBahanRoutes);
app.use("/api/laporan/gudang-garmen/kartu-stok-barang", kartuStokBarangRoutes);
app.use("/api/laporan/gudang-garmen/mutasi-stok-bahan", mutasiStokBahanRoutes);
app.use("/api/laporan/gudang-garmen/stok-acc-vs-mka", stokAccVsMkaRoutes);
app.use("/api/laporan/gudang-garmen/stok-dc", stokDcRoutes);
app.use("/api/laporan/gudang-garmen/stok-barang-jadi", stokBarangJadiRoutes);
app.use(
  "/api/laporan/gudang-garmen/kartu-stok-barangjadi",
  kartuStokBarangJadiRoutes,
);
app.use(
  "/api/laporan/gudang-garmen/mutasi-stok-barang-jadi",
  mutasiStokBarangJadiRoutes,
);
app.use(
  "/api/laporan/gudang-garmen/standart-babaran-vs-realisasi",
  standartBabaranVsRealisasiRoutes,
);
app.use("/api/laporan/gudang-garmen/spk-belum-mkb", spkBelumMkbRoutes);
app.use("/api/laporan/gudang-garmen/po-bahan-vs-mkb", poBahanVsMkbRoutes);
app.use("/api/laporan/gudang-garmen/po-bahan-vs-bpb", poBahanVsBpbRoutes);
app.use("/api/laporan/gudang-garmen/poj-vs-bpj", pojVsBpjRoutes);
app.use(
  "/api/laporan/gudang-garmen/outstanding-po-mitra",
  outstandingPoMitraRoutes,
);
app.use(
  "/api/laporan/gudang-garmen/realisasi-minta-bahan",
  realisasiMintaBahanRoutes,
);
app.use(
  "/api/laporan/gudang-garmen/realisasi-minta-vs-lhk-cutt",
  realisasiMintaVsLhkCuttRoutes,
);
app.use("/api/laporan/gudang-garmen/spk-dtf-belum-po", spkDtfBelumPoRoutes);
app.use(
  "/api/laporan/gudang-garmen/spkv-realisasiv-lhkcutt",
  spkVsRealisasiVsLhkCuttRoutes,
);
app.use("/api/laporan/gudang-garmen/spk-vs-stbj-vs-sj", spkVsStbjVsSjRoutes);
app.use("/api/laporan/gudang-garmen/spk-mkb-vs-po-bpb", spkMkbVsPoBpbRoutes);
app.use("/api/laporan/gudang-garmen/spk-vs-po", spkVsPoRoutes);
app.use("/api/laporan/gudang-garmen/spk-vs-bpb", spkVsBpbRoutes);
app.use("/api/laporan/gudang-garmen/spk-vs-bpb-non-po", spkVsBpbNonPoRoutes);
app.use("/api/laporan/gudang-garmen/spk-close-stbj", spkCloseStbjRoutes);
app.use(
  "/api/laporan/gudang-garmen/mutasi-prod-detail",
  laporanMutasiProduksiRoutes,
);
app.use(
  "/api/laporan/gudang-garmen/kekurangan-produksi",
  laporanKekuranganProduksiRoutes,
);
app.use(
  "/api/laporan/gudang-garmen/lap-outstanding-spk",
  laporanOutstandingSpkRoutes,
);
app.use("/api/laporan/gudang-garmen/browse-spk", browseSpkRoutes);
app.use("/api/laporan/gudang-garmen/browse-map", browseMapRoutes);

app.use(
  "/api/laporan/produksi-garmen/monitoring-produksi",
  monitoringProduksiRoutes,
);
app.use(
  "/api/laporan/produksi-garmen/monitoring-kurang-prod",
  monitoringKekuranganProduksiRoutes,
);
app.use(
  "/api/laporan/produksi-garmen/monitoring-kurang-prod-jahit",
  monitoringKekuranganProduksiJahitRoutes,
);
app.use(
  "/api/laporan/produksi-garmen/monitoring-kurang-prodv2",
  monitoringKekuranganProduksiV2Routes,
);
app.use(
  "/api/laporan/produksi-garmen/monitoring-bhn-datang",
  monitoringKedatanganBahanRoutes,
);
app.use("/api/laporan/produksi-garmen/monitoring-bs", monitoringBsRoutes);
app.use("/api/laporan/produksi-garmen/stok-by-line", stokProduksibyLineRoutes);
app.use(
  "/api/laporan/produksi-garmen/outstanding-bordir",
  outstandingBordirRoutes,
);
app.use(
  "/api/laporan/produksi-garmen/pemakaian-obat",
  laporanPemakaianObatRoutes,
);

app.use("/api/laporan/penjualan/penawaran-vs-spk", penawaranVsSpkRoutes);
app.use("/api/laporan/penjualan/realisasi-penawaran", realisasiPenawaranRoutes);
app.use("/api/laporan/penjualan/spk-vs-stbj", spkVsStbjRoutes);
app.use("/api/laporan/penjualan/spk-vs-sj", spkVsSjRoutes);
app.use("/api/laporan/penjualan/spk-vs-sj-vs-inv", spkVsSjVsInvRoutes);
app.use("/api/laporan/penjualan/map-vs-sj", mapVsSjRoutes);
app.use("/api/laporan/penjualan/map-vs-spk", mapVsSpkRoutes);

app.use("/api/laporan/marketing/penawaran-vs-map", penawaranVsMapRoutes);
app.use("/api/laporan/marketing/map-belum-realisasi", mapBelumRealisasiRoutes);
app.use("/api/laporan/marketing/spk-belum-closing", spkBelumClosingRoutes);
app.use("/api/laporan/marketing/realisasi-penjualan", realisasiPenjualanRoutes);
app.use("/api/laporan/marketing/rekap-map", rekapMapRoutes);
app.use("/api/laporan/marketing/rekap-penawaran", rekapPenawaranRoutes);
app.use("/api/laporan/marketing/kunjungan-sales", kunjunganSalesRoutes);

app.use("/api/laporan/piutang/detail-piutang", detailPiutangRoutes);
app.use("/api/laporan/piutang/rekap-piutang", rekapPiutangRoutes);
app.use("/api/laporan/piutang/kartu-piutang", kartuPiutangRoutes);
app.use("/api/laporan/piutang/daftar-penerimaan", daftarPenerimaanRoutes);
app.use("/api/laporan/piutang/cek-gagal-link", cekGagalLinkRoutes);

app.use("/api/tools/users", userRoutes);
app.use("/api/tools/user-form", userFormRoutes);
app.use("/api/tools/approval", approvalRoutes);

const PORT = process.env.PORT || 3088;
app.listen(PORT, () => {
  console.log(`Server Manksi running on port ${PORT}`);
});
