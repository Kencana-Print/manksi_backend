const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/permintaanDesainFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 184; // ID Menu Permintaan Desain

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  controller.createPD,
);

module.exports = router;
