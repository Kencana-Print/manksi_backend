const express = require("express");
const router = express.Router();
const mkbFormController = require("../../controllers/pembelian/mkbFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware"); // Sesuaikan letak authMiddleware Anda

const MENU_ID = 51;

// --- ROUTE LOAD DATA MKB (EDIT MODE) ---
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbFormController.getById,
);

// --- ROUTE SAVE TRANSAKSI ---
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"), // Anggap insert/update diatur di controller/service
  mkbFormController.save,
);

router.get(
  "/print",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbFormController.getPrintData,
);

router.get(
  "/check-spk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbFormController.checkSpk,
);

router.get(
  "/linkable-po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbFormController.getLinkablePo,
);

module.exports = router;
