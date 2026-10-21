const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/rekapPembayaranController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "970";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);
router.patch(
  "/:nomor/batal",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.batalData,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
