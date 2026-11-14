const express = require("express");
const router = express.Router();
const poBahanFormController = require("../../controllers/pembelian/poBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 52; // Sesuai dengan Browse
const REKAP_MENU_ID = 972; // Rekap Belanja

router.get("/validate", verifyToken, poBahanFormController.validateField);

router.get(
  "/supplier/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  poBahanFormController.getSupplierByKode,
);

router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  poBahanFormController.getDetail,
);

router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"), // Base permission, edit will be handled internally or UI
  poBahanFormController.save,
);

// GET /api/pembelian/po-bahan/mkb-detail/:nomor
router.get(
  "/mkb-detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  poBahanFormController.getMkbDetail,
);

router.get(
  "/mbb-outstanding",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  poBahanFormController.getMbbOutstanding,
);

router.get(
  "/rekap/:nomor",
  verifyToken,
  checkPermission(REKAP_MENU_ID, "view"),
  poBahanFormController.getRekap,
);

router.post(
  "/rekap/save",
  verifyToken,
  checkPermission(REKAP_MENU_ID, "insert"),
  poBahanFormController.saveRekap,
);

module.exports = router;
