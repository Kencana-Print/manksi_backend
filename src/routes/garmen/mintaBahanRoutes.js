const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/mintaBahanController");
const formController = require("../../controllers/garmen/mintaBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "127";

// ==========================================
// 1. RUTE STATIS & SPESIFIK (WAJIB DI ATAS)
// ==========================================
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/all-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getAllDetail,
);
router.get(
  "/check-insert",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.checkInsertEligibility,
);

// Rute Options & Lookup SPK
router.get("/options/komponen", verifyToken, formController.getKomponen);
router.get("/spk-info/:spk", verifyToken, formController.getSpkInfo);

// Rute Form (GET detail, POST simpan baru, PUT edit data)
router.get(
  "/form/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.getDetail,
);
router.post(
  "/form",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  formController.saveData,
);
router.put(
  "/form/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  formController.saveData,
);
router.get("/print/:nomor", verifyToken, formController.getPrintData);

// ==========================================
// 2. RUTE DINAMIS /:nomor (WAJIB DI BAWAH)
// ==========================================
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

// Rute Action
router.put(
  "/:nomor/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.setClose,
);
router.put(
  "/:nomor/approve-gudang",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.approveGudang,
);
router.put(
  "/:nomor/approve-manager",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.approveManager,
);
router.post(
  "/:nomor/ajukan-perubahan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.ajukanPerubahan,
);
router.put(
  "/realisasi/:nomorRealisasi/approve",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.approveRealisasi,
);

module.exports = router;
