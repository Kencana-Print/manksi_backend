const express = require("express");
const router = express.Router();
const bpbNonBahanController = require("../../controllers/garmen/bpbNonBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 67; // BPB Non Bahan

// Browse Master-Detail
router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  bpbNonBahanController.getBrowse,
);

// Delete Data
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  bpbNonBahanController.deleteData,
);

// Pengajuan PIN 5
router.post(
  "/pin",
  verifyToken,
  checkPermission(menuId, "edit"),
  bpbNonBahanController.requestPin,
);

module.exports = router;
