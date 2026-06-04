const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/piutang/penerimaan/cashFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 252; // Piutang > Penerimaan > Cash

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
);

module.exports = router;
