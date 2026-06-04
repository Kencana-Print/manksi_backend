const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/piutang/penerimaan/giroFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 251; // Piutang > Penerimaan > Giro

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveData,
);
router.put(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.saveData,
); // Boleh gunakan logic yang sama dengan insert

module.exports = router;
