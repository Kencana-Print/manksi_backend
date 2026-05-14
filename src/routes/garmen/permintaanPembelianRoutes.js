const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/permintaanPembelianController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Sesuai requirement: MENU_ID = 65
const MENU_ID = 65;

// Browse & Detail
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseDetail,
);

// Actions
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deletePermintaan,
);

router.post(
  "/:nomor/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.closePermintaan,
);

router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin,
);

router.post(
  "/:nomor/estimasi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateEstimasi,
);

module.exports = router;
