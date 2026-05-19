const express = require("express");
const router = express.Router();
const controller = require("../controllers/lookupController");
const { verifyToken } = require("../middleware/authMiddleware");

// Endpoint: /api/lookups/spk
router.get("/spk", verifyToken, controller.searchSpk);

// Endpoint khusus untuk pencarian SPK di form BAP Produksi
router.get("/spk-produksi", verifyToken, controller.searchSpkProduksi);

// Endpoint: /api/lookups/bahan
router.get("/bahan", verifyToken, controller.searchBahan);

// Endpoint: /api/lookups/customer
router.get("/customer", verifyToken, controller.searchCustomer);

router.get("/cabang-pabrik", verifyToken, controller.getCabangPabrik);

router.get("/bagian-produksi", verifyToken, controller.searchBagianProduksi); // kirim ?cabang=HO-

router.get("/sales", verifyToken, controller.getSales);

router.get(
  "/jenis-kain-minta-harga",
  verifyToken,
  controller.getJenisKainMintaHarga,
);

router.get("/komponen-kain", verifyToken, controller.getKomponenKain);

router.get("/cetak", verifyToken, controller.getCetakOptions);

router.get("/tambahan", verifyToken, controller.getTambahanOptions);

router.get("/perusahaan", verifyToken, controller.getPerusahaan);

router.get("/rekening", verifyToken, controller.getRekening);

router.get("/divisi", verifyToken, controller.getDivisi);

router.get("/minta-harga", verifyToken, controller.searchMintaHarga);

// Endpoint: /api/lookups/jenis-order
// Digunakan di JenisOrderSearchModal.vue (Menerima param ?divisi=)
router.get("/jenis-order", verifyToken, controller.searchJenisOrder);

// Endpoint: /api/lookups/penawaran
// Digunakan di PenawaranSearchModal.vue
router.get("/penawaran", verifyToken, controller.searchPenawaran);

// Endpoint: /api/lookups/penawaran-detail
// Digunakan di PenawaranDetailSearchModal.vue (Menerima param ?nomor=)
router.get("/penawaran-detail", verifyToken, controller.searchPenawaranDetail);

// Endpoint: /api/lookups/map-garmen
// Digunakan di MapSearchModal.vue
router.get("/map-garmen", verifyToken, controller.searchMapGarmen);

// Endpoint: /api/lookups/map-garmen/validate/:nomor
// Digunakan untuk validasi input manual (on blur)
router.get(
  "/map-garmen/validate/:nomor",
  verifyToken,
  controller.validateMapGarmen,
);

// Endpoint: /api/lookups/po-internal
// Digunakan untuk mencari referensi PO di Form Surat Jalan MAP
router.get("/po-internal", verifyToken, controller.searchPoInternal);

// Endpoint: /api/lookups/accesories
router.get("/accesories", verifyToken, controller.searchAccesories);

// Endpoint: /api/lookups/komponen
router.get("/komponen", verifyToken, controller.getKomponen);

// Endpoint: /api/lookups/minta-bahan
// Digunakan di MintaBahanSearchModal.vue
router.get("/minta-bahan", verifyToken, controller.searchMintaBahan);

// Endpoint: /api/lookups/realisasi-minta
// Digunakan di RealisasiMintaSearchModal.vue
router.get("/realisasi-minta", verifyToken, controller.searchRealisasiMinta);

// Endpoint: /api/lookups/realisasi-minta-detail
// Digunakan di RealisasiMintaDetailSearchModal.vue (Menerima param ?nomor= & ?gdg=)
router.get(
  "/realisasi-minta-detail",
  verifyToken,
  controller.searchRealisasiMintaDetail,
);

// Endpoint: /api/lookups/gudang-produksi
// Digunakan di GudangProduksiSearchModal.vue (Menerima param ?cabang=)
router.get("/gudang-produksi", verifyToken, controller.searchGudangProduksi);

router.get("/barang-garmen", verifyToken, controller.searchBarangGarmen);

// Endpoint: /api/lookups/permintaan-barang-garmen
// Digunakan di PermintaanBarangSearchModal.vue (Menerima param ?jenis=)
router.get(
  "/permintaan-barang-garmen",
  verifyToken,
  controller.searchPermintaanBarangGarmen,
);

router.get(
  "/barang-inv-proforma",
  verifyToken,
  controller.searchBarangInvProforma,
);

router.get("/workshop", verifyToken, controller.getWorkshops);

router.get("/kepentingan-spk", verifyToken, controller.getKepentinganSpk);
router.get("/ket-po", verifyToken, controller.getKetPo);
router.get("/ket-komponen", verifyToken, controller.getKetKomponen);

router.get("/cust-kaosan", verifyToken, controller.searchCustKaosan);
router.get("/so-kaosan", verifyToken, controller.searchSoKaosan);
router.get("/inv-dc", verifyToken, controller.searchInvDc);
router.get("/sj-memo", verifyToken, controller.searchSjMemo);
router.get("/memo", verifyToken, controller.searchMemo);
router.get("/mppb", verifyToken, controller.searchMppb);

router.get("/history-alokasi", verifyToken, controller.getHistoryAlokasi);

router.get("/barang-kaosan", verifyToken, controller.searchBarangKaosan);

router.get("/supplier", verifyToken, controller.searchSupplier);
router.get("/po-greige", verifyToken, controller.searchPoGreige);
router.get("/mkb", verifyToken, controller.searchMkb);

router.get("/gudang-bahan", verifyToken, controller.searchGudangBahan);
router.get("/po-bahan-buka", verifyToken, controller.searchPoBahanBuka);

router.get(
  "/permintaan-beli-garmen",
  verifyToken,
  controller.searchPermintaanBeliGarmen,
);

// Endpoint: /api/lookups/po-garmen-buka
router.get("/po-garmen-buka", verifyToken, controller.searchPoGarmenBuka);

module.exports = router;
