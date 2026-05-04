const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/obatController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID 24 = Master Obat
const menuId = 24;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get("/lookups/:category", verifyToken, controller.getLookups); // Harus di atas /:kode
router.get(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.create,
);
router.put(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.update,
);

module.exports = router;
