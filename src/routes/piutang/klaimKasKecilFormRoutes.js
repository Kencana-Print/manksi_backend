const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/klaimKasKecilFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "971";

router.get(
  "/defaults",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDefaults,
);
router.get(
  "/bkk-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBkkOptions,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.create);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

module.exports = router;
