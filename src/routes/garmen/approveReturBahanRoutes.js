const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/approveReturBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "137";

// GET Browse Data
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

// DELETE Batal Approve (Berdasarkan NoApprov / RETP)
router.delete(
  "/batal/:noApprov",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.batalApprove,
);

module.exports = router;
