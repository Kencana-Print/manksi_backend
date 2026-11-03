const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ppic/lhkMarkerController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 179;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/antrean",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAntrean,
);

module.exports = router;
