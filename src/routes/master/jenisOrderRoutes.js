const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/jenisOrderController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID 22 = Jenis Order
const menuId = 22;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
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
