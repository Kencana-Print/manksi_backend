const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/sjPoInternalSpkFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 125;

router.get(
  "/check-po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkPO,
);
router.get(
  "/check-spk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkSpk,
);
router.get(
  "/check-gudang-produksi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkGudangProduksi,
);
router.get(
  "/komponen-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getKomponenOptions,
);
router.get(
  "/kelompok-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getKelompokOptions,
);
router.get(
  "/kelompok-tujuan-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getKelompokTujuanOptions,
);
router.get(
  "/check-supplier",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkSupplier,
);
router.get(
  "/check-no-material",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkNoMaterial,
);
router.get(
  "/babaran-standar",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBabaranStandar,
);
router.post(
  "/load-bahan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.loadBahan,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);

module.exports = router;
