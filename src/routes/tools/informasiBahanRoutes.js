const express = require("express");
const router = express.Router();
const controller = require("../../controllers/tools/informasiBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 1322;

// Reminder dipakai lintas modul (form MAP/SPK/SO) — cukup login,
// tidak digate izin menu Sistem Informasi Bahan secara spesifik,
// karena ini fitur bantu/reminder bukan akses ke datanya langsung.
router.get("/reminder", verifyToken, controller.reminder);

router.get(
  "/search",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.search,
);
router.get(
  "/slow-moving",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.slowMoving,
);
router.get(
  "/kartu/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.kartuPergerakan,
);

module.exports = router;
