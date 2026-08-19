const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/gudang-garmen/realisasiKeluarBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 529;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

module.exports = router;
