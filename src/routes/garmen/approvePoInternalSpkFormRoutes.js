const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/approvePoInternalSpkFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 126;

router.get(
  "/print/:mpNomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);
router.post(
  "/:nomor/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveApprove,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);

module.exports = router;
