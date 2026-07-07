const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/lhkPolaController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 174;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

module.exports = router;
