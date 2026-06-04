const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/piutang/penerimaan/cashController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 252; // Piutang > Penerimaan > Cash

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
  controller.deleteCash,
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
