const express = require("express");
const router = express.Router();
const controller = require("../../controllers/piutang/pengajuanDanaController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 177;

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
router.post(
  "/:nomor/close-manual",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.closeManual,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.deleteData,
);

module.exports = router;
