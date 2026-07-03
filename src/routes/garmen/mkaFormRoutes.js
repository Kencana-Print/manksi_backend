// routes/garmen/mkaFormRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/mkaFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 57;

// GET /api/garmen/mka-form/detail?nomor=MKA/0001/2025
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

// GET /api/garmen/mka-form/spk-info?spkNomor=SPK-JA-KK-000001
// → cek SPK, auto-load existing MKA atau pre-fill dari MAP
router.get(
  "/spk-info",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkInfo,
);

// GET /api/garmen/mka-form/aksesoris?search=benang
router.get(
  "/aksesoris",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAksesorisMaster,
);

// GET /api/garmen/mka-form/aksesoris-by-kode?kode=ACC001&spkJumlah=100&excludeMkaNomor=MKA/0001/2025
router.get(
  "/aksesoris-by-kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAksesorisByKode,
);

// POST /api/garmen/mka-form → create / update
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.saveData,
);

// DELETE /api/garmen/mka-form?nomor=MKA/0001/2025
router.delete(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
