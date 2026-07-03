const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/cetakKuitansiController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "1317";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

router.get(
  "/search-invoice",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchInvoice,
);
router.get(
  "/data-cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);
router.post(
  "/cetak",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.cetak,
);

module.exports = router;
