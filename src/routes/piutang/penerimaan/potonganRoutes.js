const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/piutang/penerimaan/potonganController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 254; // Piutang > Penerimaan > Potongan

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
  controller.deletePotongan,
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
router.put(
  "/pph23/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updatePph23,
);

module.exports = router;
