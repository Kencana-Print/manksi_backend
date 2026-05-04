const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/realisasiBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "108";

// --- Rute GET ---
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getExportDetail,
);

// Rute Dinamis GET (Selalu letakkan di bawah rute GET spesifik)
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

// --- Rute ACTION ---
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);
router.post(
  "/ajukan-perubahan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.ajukanPerubahan,
);

module.exports = router;
