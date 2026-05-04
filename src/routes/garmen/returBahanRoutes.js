const express = require("express");
const router = express.Router();
const returBahanController = require("../../controllers/garmen/returBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "110";

// Route Get Browse
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  returBahanController.getBrowse,
);

// Route Delete
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  returBahanController.deleteRetur,
);

// Route Pengajuan Perubahan Data (Pin 5)
router.post(
  "/request-edit",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  returBahanController.requestEdit,
);

module.exports = router;
