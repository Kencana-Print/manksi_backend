const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/permintaanDesainController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 184; // ID Menu Permintaan Desain

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/search",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchReferensi,
);
router.put(
  "/:nomor/status",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.setStatusManual,
);
router.put(
  "/:nomor/resume",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.resumeStatus,
);
router.get(
  "/desainer-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDesainerOptions,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.put(
  "/:nomor/progress",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateProgress,
);
router.put(
  "/:nomor/desainer",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateDesainer,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateHeader,
);

module.exports = router;
