const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/maklonBarangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 181;

router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);
router.post(
  "/:nomor/pengajuan-ubah",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.pengajuanUbah,
);

module.exports = router;
