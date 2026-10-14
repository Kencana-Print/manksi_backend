const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/daftar/bahanPenolongController");
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
  controller.getBrowseBahanPenolong,
);
router.get("/lookups/:category", verifyToken, controller.getLookups);
router.get(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBahanPenolongById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.createBahanPenolong,
);
router.put(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.updateBahanPenolong,
);
router.delete(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.deleteBahanPenolong,
);

module.exports = router;
