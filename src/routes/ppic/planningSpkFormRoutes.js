// routes/ppic/planningSpkFormRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ppic/planningSpkFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 56;

// GET /api/ppic/planning-spk-form/spk-info?nomor=...
router.get(
  "/spk-info",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkInfo,
);

// GET /api/ppic/planning-spk-form/qty-po?spkNomor=...
// Harus di atas /:nomor agar tidak terambil sebagai param
router.get(
  "/qty-po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getQtyPoJasa,
);

// GET  /api/ppic/planning-spk-form/riwayat?spk=A&spk=B&excludeNomor=...
// POST /api/ppic/planning-spk-form/riwayat  body: { spkList:[], excludeNomor }
router.get(
  "/riwayat",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getRiwayatSpk,
);
router.post(
  "/riwayat",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getRiwayatSpk,
);

// GET /api/ppic/planning-spk-form/:nomor
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getFormDetail,
);

// POST /api/ppic/planning-spk-form
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.saveData,
);

module.exports = router;
