const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/piutang/penerimaan/transferController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 253; // Piutang > Penerimaan > Transfer

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteTransfer,
);
router.get(
  "/check-pengajuan/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.checkPengajuan,
);
router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin,
);

module.exports = router;
