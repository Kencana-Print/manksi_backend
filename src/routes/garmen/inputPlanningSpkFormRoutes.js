const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/inputPlanningSpkFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 80;

router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveData,
);

module.exports = router;
