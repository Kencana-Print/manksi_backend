// backend/src/routes/soToSpk.routes.js
const express = require("express");
const router = express.Router();
const controller = require("../../../../controllers/mmt/transaksi-khusus/spk-order/soToSpkController");

// 🟢 1. IMPORT MIDDLEWARE AUTH JWT
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken; // Sesuaikan path file auth.middleware.js Anda

// 💡 Pilihan A: Jika SEMUA route di file ini wajib login, pasang router.use di sini:
router.use(verifyToken);

// ==========================================
// 1. ROUTE STATIS / SPESIFIK (Wajib Di Atas)
// ==========================================

router.get("/detail", controller.getDetail);
router.get("/so-source", controller.getSoSource);

// 🟢 Rute simpan sekarang sudah terlindungi & membaca JWT user asli
router.post("/save", controller.save);
router.put("/save", controller.save);

router.get("/init-sizes", controller.getInitSizes);
router.get("/standar-ukuran", controller.getStandarUkuran);
router.get("/mkb-detail", controller.getMkbDetailBySpk);
router.get("/komponen-master", controller.getKomponenMaster);

router.get("/mka-from-map/:mapNomor", controller.getMkaFromMap);
router.get("/komponen-from-proof/:identifier", controller.getKomponenFromProof);

router.post("/layout-proses/import", controller.importLayoutProses);
router.get("/layout-proses", controller.getLayoutProses);
router.get("/keterangan-khusus", controller.getKeteranganKhusus);
router.get("/ket-komponen-master", controller.getKetKomponenMaster);
router.get("/alokasi", controller.getAlokasi);

// ==========================================
// 2. ROUTE UTAMA & DENGAN PARAMETER (:nomor)
// ==========================================

router.get("/", controller.getBrowse);

// Routes dengan parameter ditaruh di bawah agar tidak memblokir route statis
router.get("/:nomor/sizes", controller.getSizes);
router.delete("/:nomor", controller.deleteSpk);
router.put("/:nomor/toggle-close", controller.toggleStatus);

// --- Approval & PIN ---
router.post("/:nomor/request-pin", controller.requestPin);
router.put("/:nomor/approve", controller.approveCmo);

// --- Cetak / Print ---
router.get("/:nomor/print-check", controller.checkPrintPermission);
router.post("/:nomor/request-print-approval", controller.requestPrintApproval);
router.post("/:nomor/record-print", controller.recordPrint);

module.exports = router;
