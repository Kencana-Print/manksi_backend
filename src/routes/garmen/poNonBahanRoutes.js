const express = require("express");
const router = express.Router();
const poNonBahanController = require("../../controllers/garmen/poNonBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 66;

// Browse Master-Detail
router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  poNonBahanController.getBrowse,
);

// Delete Data
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  poNonBahanController.deleteData,
);

// PIN 5 (Pengajuan Edit)
router.post(
  "/pin",
  verifyToken,
  checkPermission(menuId, "edit"),
  poNonBahanController.requestPin,
);

module.exports = router;
