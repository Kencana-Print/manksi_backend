const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/voucherPembayaranController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "201";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);
router.get(
  "/pending-all",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowsePendingAll,
);
router.get(
  "/pending-all/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetailPendingAll,
);
router.get(
  "/:nomor/print",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPrintData,
);
router.get(
  "/:nomor/cek-pengajuan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekPengajuan,
);
router.post(
  "/:nomor/request-pin5",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.requestPin5,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
