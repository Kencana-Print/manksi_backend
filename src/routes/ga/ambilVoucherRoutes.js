const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/ga/ambilVoucherController");

const MENU_ID = 613;

// ── STATIC GET ─────────────────────────────────────────────────────────
router.get("/max-kode", verifyToken, ctrl.getMaxKode);
router.get("/lookups", verifyToken, ctrl.getLookups);

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

// ── DYNAMIC /:kode/:id ─────────────────────────────────────────────────
router.get(
  "/:kode/:id",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

router.put(
  "/:kode/:id",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

router.delete(
  "/:kode/:id",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.remove,
);

module.exports = router;
