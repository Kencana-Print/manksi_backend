const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/mintaBarangFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "60"; // Menu Minta Barang Garmen

router.get("/validate-spk/:spk", verifyToken, controller.validateSpk);

// Get Detail untuk Edit Form
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

// Save Data (Insert / Update otomatis dihandle di Service berdasarkan payload.nomor)
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"), // Akses insert/edit akan divalidasi juga di BaseForm Frontend
  controller.save,
);

module.exports = router;
