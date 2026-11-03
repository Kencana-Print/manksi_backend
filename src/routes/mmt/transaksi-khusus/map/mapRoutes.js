const express = require("express");
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require("../../../../controllers/mmt/transaksi-khusus/map/mapController");
const multer = require("multer");
const upload = multer({ dest: "uploads/temp/" }); // Lokasi sementara sebelum diolah sharp/fs

// 1. ROUTE BROWSE & MASTER DATA (STATIC)
router.get("/", verifyToken, controller.getBrowseList);
router.get("/init-grids", verifyToken, controller.getInitGrids);
router.get("/spk-informasi/:divisi", verifyToken, controller.getSpkInformasi);
router.get("/generate-nomor", verifyToken, controller.generateNomor);

// 2. HELPER & LOOKUP
router.get("/minta-harga/:nomor", verifyToken, controller.loadMintaHarga);
router.get("/suggestions/nama", verifyToken, controller.getNamaSuggestions);
router.get("/check-duplikat", verifyToken, controller.checkDuplikatNama);
router.get(
  "/katalog-customer/:cusKode",
  verifyToken,
  controller.getKatalogCustomer,
);

// 3. FITUR DESIGN
router.get("/design/list", verifyToken, controller.getDesignList);
router.put("/design/status", verifyToken, controller.updateDesignStatus);

// 4. SAVE & MUTASI DATA
router.post("/", verifyToken, controller.saveMap);

// Komponen MAP — WAJIB sebelum route dinamis :nomor di bawah.
// Dipakai pemilih komponen (lookup SPK sublimasi) untuk MAP.
router.get("/:nomor/komponen", verifyToken, controller.getKomponenByMap);

// 5. ROUTE DINAMIS DENGAN PARAMETER :nomor (MUST BE AT THE BOTTOM)
router.get("/:nomor", verifyToken, controller.getById);
router.get("/:nomor/print", verifyToken, controller.getPrintData);
router.post(
  "/:nomor/upload",
  verifyToken,
  upload.single("file"),
  controller.uploadFile,
);
router.put("/:nomor/close", verifyToken, controller.toggleClose);
router.put("/:nomor/approve", verifyToken, controller.approveCmo);
router.post("/:nomor/pin5", verifyToken, controller.requestPin5);
router.delete("/:nomor", verifyToken, controller.deleteMap);

module.exports = router;
