const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/garmen/approvePoJasaController");

const MENU_ID = "113";

router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.post(
  "/toggle",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.toggleApprove,
);
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

module.exports = router;
