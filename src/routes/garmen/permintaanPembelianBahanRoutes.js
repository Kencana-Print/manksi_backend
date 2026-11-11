const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/permintaanPembelianBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 190;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseDetailRange,
);

router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseDetail,
);

router.get(
  "/:nomor/print",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);

router.post(
  "/:nomor/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.closeData,
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deletePermintaan,
);

module.exports = router;
