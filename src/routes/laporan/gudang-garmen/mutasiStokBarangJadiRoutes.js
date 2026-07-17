const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/gudang-garmen/mutasiStokBarangJadiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 508;

// Rute statis WAJIB di atas '/:kode' generik.
router.get(
  "/all-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAllDetail,
);

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

router.get(
  "/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

module.exports = router;
