const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/salesOrderFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware");

const MENU_ID = 172; // ID Menu SPK/Sales Order (PPIC/MO)

router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.get("/validate", verifyToken, controller.validateField);
router.get("/memo-detail", verifyToken, controller.getMemoDetail);
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);
router.put(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.save,
); // Menggunakan PUT untuk konsistensi Edit (Opsional, di service sudah handle isEdit via POST juga bisa)
router.post(
  "/upload-gambar",
  verifyToken,
  upload.single("gambar"),
  controller.uploadImage,
);
router.get("/dateline-limits", verifyToken, controller.getDatelineLimits);
router.get("/check-top-urgent", verifyToken, controller.checkHakTopUrgent);
router.get("/init-sizes", verifyToken, controller.getInitSizes);
router.get("/komponen-init", verifyToken, controller.getKomponenMaster);
router.get("/standar-ukuran", verifyToken, controller.getStandarUkuran);
router.get(
  "/katalog/customer/:cusKode",
  verifyToken,
  controller.getKatalogCustomer,
);
// di routes
router.get("/sj-memo-map-list", verifyToken, controller.getSjMemoMapList);
router.get("/sj-memo-by-map", verifyToken, controller.findSjMemoByMap);

module.exports = router;
