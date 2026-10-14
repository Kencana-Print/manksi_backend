const express = require("express");
const router = express.Router();
const masterBahanController = require("../../../controllers/spanduk/daftar/masterBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Spanduk tidak punya menu id per submenu — akses dicek ke menu parent.
const menuId = 4;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  masterBahanController.getBrowseMasterBahan,
);
router.get("/lookups/:category", verifyToken, masterBahanController.getLookups);
router.get(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "view"),
  masterBahanController.getMasterBahanById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  masterBahanController.createMasterBahan,
);
router.put(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "edit"),
  masterBahanController.updateMasterBahan,
);
router.delete(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "delete"),
  masterBahanController.deleteMasterBahan,
);

module.exports = router;
