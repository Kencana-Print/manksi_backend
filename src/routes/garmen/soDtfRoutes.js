const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/soDtfController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "128";

router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

module.exports = router;
