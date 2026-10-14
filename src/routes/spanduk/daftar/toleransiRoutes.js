const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/daftar/toleransiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Tidak ada menu id khusus: cek akses ke menu induk Spanduk
const menuId = 4;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowseToleransi,
);
router.get("/lookups/:category", verifyToken, controller.getLookups);
router.get(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getToleransiById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.createToleransi,
);
router.put(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.updateToleransi,
);
router.delete(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.deleteToleransi,
);

module.exports = router;
