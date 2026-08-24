const express = require("express");
const router = express.Router();
const controller = require("../../controllers/pembelian/poExternalGarmenController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 144;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get(
  "/export-header",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.exportHeader,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.exportDetail,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.remove,
);
router.get(
  "/:nomor/pengajuan",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.getPengajuanInfo,
);
router.post(
  "/:nomor/pengajuan",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.ajukanPerubahan,
);

module.exports = router;
