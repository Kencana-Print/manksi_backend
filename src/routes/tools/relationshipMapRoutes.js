const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/tools/relationshipMapController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 1321;

router.get(
  "/expand",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getExpand,
);
router.get(
  "/search",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSearch,
);

module.exports = router;
