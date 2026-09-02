// routes/ppic/penjadwalanPpicRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/ppic/penjadwalanPpicController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 176;

router.get(
  "/browse",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getDetail,
);
router.put(
  "/:nomor/close",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.toggleClose,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.deleteData,
);

module.exports = router;
