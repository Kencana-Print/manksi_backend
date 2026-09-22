const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/pembelian/uangMukaRealisasiController");

const MENU_ID = 315;

router.use(verifyToken);

router.get(
  "/account-options",
  checkPermission(MENU_ID, "view"),
  ctrl.getAccountOptions,
);
router.get(
  "/supplier-options",
  checkPermission(MENU_ID, "view"),
  ctrl.getSupplierOptions,
);
router.get(
  "/pum-options",
  checkPermission(MENU_ID, "view"),
  ctrl.getPumOptions,
);
router.get("/print/:nomor", verifyToken, ctrl.getPrintData);
router.get("/:nomor", checkPermission(MENU_ID, "view"), ctrl.getDetail);
router.post(
  "/:nomor/realisasi",
  checkPermission(MENU_ID, "save"),
  ctrl.saveRealisasi,
);

module.exports = router;
