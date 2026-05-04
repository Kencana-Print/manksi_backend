const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/accKetController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID 34 = Keterangan Accesories
const menuId = 34;

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
router.delete(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.remove,
);

module.exports = router;
