const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/ppic/keberhasilanKomitmenKirimController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 1326;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getKeberhasilanKomitmenKirim,
);

module.exports = router;
