const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/marketing/soBelumKomitmenController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 571;

router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabang,
);
router.get(
  "/divisi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDivisi,
);

module.exports = router;
