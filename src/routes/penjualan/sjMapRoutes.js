const express = require("express");
const router = express.Router();
const browseController = require("../../controllers/penjualan/sjMapController");
const formController = require("../../controllers/penjualan/sjMapFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Ingat: menu_id Surat Jalan MAP adalah 163
const MENU_ID = 163;

// Endpoint Browse
router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  browseController.getBrowseData,
);

// Endpoint Delete
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  browseController.deleteData,
);

// Endpoint PIN 5 (Pengajuan Edit)
router.get("/pin5/:nomor", verifyToken, browseController.getPengajuanStatus);
router.post("/pin5/ajukan", verifyToken, browseController.ajukanPerubahanData);

// Form Routes
router.get("/form/item-details", verifyToken, formController.getMapItem);
router.get(
  "/form/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.getDetails,
);
router.post(
  "/form",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  formController.saveSj,
);
router.get("/print-data/:nomor", verifyToken, formController.getPrintData);

module.exports = router;
