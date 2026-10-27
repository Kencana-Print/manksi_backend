const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/ga/perawatanController");

const MENU_ID = 611;

// ── STATIC GET ─────────────────────────────────────────────────────────
router.get("/generate-nomor", verifyToken, ctrl.generateNomor);
router.get("/search-kendaraan", verifyToken, ctrl.searchKendaraan);

// ── BROWSE ROOT ────────────────────────────────────────────────────────
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowse,
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.create,
);

// ── DYNAMIC /:nomor ────────────────────────────────────────────────────
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
