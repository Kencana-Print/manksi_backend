const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/kendalaController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 37;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get(
  "/export",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.exportExcel,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.remove,
);

module.exports = router;
