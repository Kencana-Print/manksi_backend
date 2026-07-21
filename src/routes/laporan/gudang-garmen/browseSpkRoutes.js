const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/gudang-garmen/browseSpkController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 527;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

router.get(
  "/:nomor/print-permission",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPrintPermission,
);
router.post(
  "/:nomor/request-print-approval",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.requestPrintApproval,
);
router.post(
  "/:nomor/record-print",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.recordPrint,
);

module.exports = router;
