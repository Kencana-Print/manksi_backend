const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/salesOrderFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

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

module.exports = router;
