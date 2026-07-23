const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/produksi-garmen/monitoringKedatanganBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 557;

router.get(
  "/all-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAllDetail,
);
router.get(
  "/flattened",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getFlattenedRows,
);

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

router.get(
  "/:spk/:tglMinta",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

module.exports = router;
