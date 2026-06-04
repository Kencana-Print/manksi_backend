const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/piutang/penerimaan/giroController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 251; // Piutang > Penerimaan > Giro

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/check-pengajuan/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.checkPengajuan,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteGiro,
);
router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin,
);

module.exports = router;
