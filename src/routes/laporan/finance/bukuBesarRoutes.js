const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/finance/bukuBesarController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID Laporan Finance = 969
router.get(
  "/default-account",
  verifyToken,
  checkPermission(969, "view"),
  controller.getDefaultAccount,
);
router.get(
  "/account-options",
  verifyToken,
  checkPermission(969, "view"),
  controller.searchAccount,
);
router.get(
  "/account/:kode",
  verifyToken,
  checkPermission(969, "view"),
  controller.getAccountByKode,
);
router.get(
  "/",
  verifyToken,
  checkPermission(969, "view"),
  controller.getBukuBesar,
);

module.exports = router;
