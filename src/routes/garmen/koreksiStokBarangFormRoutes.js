const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/koreksiStokBarangFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "64";

router.get(
  "/search-barang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchBarang,
);
router.get(
  "/resolve-kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.resolveKode,
);
router.get(
  "/cetak/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDataCetak,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getFormData,
);

module.exports = router;
