const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/realisasiBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "108";

// 1. Rute Khusus Helper & Lookups
router.get("/permintaan-info", verifyToken, controller.getPermintaanInfo);
router.get("/barcode-info/:barcode", verifyToken, controller.getBarcodeInfo);

// 2. Rute Load Data Edit
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.loadDataEdit,
);

// 3. Rute Simpan (Save)
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveData,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.saveData,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);

module.exports = router;
