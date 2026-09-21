const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/alokasiSoController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 183;

router.get(
  "/browse",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowseData,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getAlokasi,
);
router.post(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.saveAlokasi,
);

module.exports = router;
