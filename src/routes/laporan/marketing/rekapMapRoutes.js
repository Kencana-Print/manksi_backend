const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/marketing/rekapMapController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 311;

router.get(
  "/rekap",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getRekap,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.put(
  "/update-note",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateNote,
);

module.exports = router;
