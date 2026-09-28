const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/pembelian/pengajuanTransferController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "958";

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
  "/:nomor/status",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getStatus,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
