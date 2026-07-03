// routes/ppic/planningSpkRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ppic/planningSpkController");
const { verifyToken, checkPermission } = require("../../middleware/authMiddleware");

const MENU_ID = 56;

// GET /api/ppic/planning-spk?startDate=2026-06-22&endDate=2026-06-27
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowse,
);

// GET /api/ppic/planning-spk/:nomor/detail
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

// GET /api/ppic/planning-spk/detail-aktual?startDate=...&endDate=...
router.get(
  "/detail-aktual",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailAktual,
);

// PATCH /api/ppic/planning-spk/:nomor/toggle-close
// body: { isClose: true|false }
router.patch(
  "/:nomor/toggle-close",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.toggleClose,
);

// DELETE /api/ppic/planning-spk/:nomor
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

// GET /api/ppic/planning-spk/export-master?startDate=...&endDate=...
router.get(
  "/export-master",
  verifyToken,
  checkPermission(MENU_ID, "export"),
  ctrl.exportMaster,
);

// GET /api/ppic/planning-spk/export-detail?startDate=...&endDate=...
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "export"),
  ctrl.exportDetail,
);

module.exports = router;