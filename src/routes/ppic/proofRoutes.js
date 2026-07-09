const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ppic/proofController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 122;

// Rute statis WAJIB di atas '/:nomor' generik.
router.get(
  "/meta",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getMeta,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getExportDetail,
);

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.remove,
);

module.exports = router;
