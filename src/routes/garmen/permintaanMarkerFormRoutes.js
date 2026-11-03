const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/permintaanMarkerFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 189;

// Lookup (didaftarkan sebelum "/:nomor")
router.get(
  "/lookups/bahan-mkb",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBahanMkb,
);
router.get(
  "/lookups/bahan/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBahanInfo,
);
router.get(
  "/lookups/setting",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSettings,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.create);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);
router.patch(
  "/:nomor/status",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.setStatus,
);

// Close oleh Admin Cutting (menu 189)
router.post(
  "/:nomor/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.closePermintaan,
);

module.exports = router;
