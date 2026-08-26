const express = require("express");
const router = express.Router();
const controller = require("../../controllers/tools/agendaKerjaController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 1323;

router.get("/badge-count", verifyToken, controller.getBadgeCount);
router.get("/is-pic", verifyToken, controller.getIsPic);
router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.save,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getById,
);
router.put(
  "/:nomor/status",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.updateStatus,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.remove,
);

module.exports = router;
