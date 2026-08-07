const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/stbjFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "105";

// ── Load detail untuk grid ────────────────────────────────────────────
router.get(
  "/spk-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkDetail,
);
router.get(
  "/spg-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpgDetail,
);
router.get(
  "/packing-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPackingDetail,
);
router.get(
  "/packing-all",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPackingAvailable,
);
router.get(
  "/cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetak,
);
router.get("/search-packing", verifyToken, ctrl.searchPacking);

// ── CRUD ─────────────────────────────────────────────────────────────
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getById);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);

module.exports = router;
