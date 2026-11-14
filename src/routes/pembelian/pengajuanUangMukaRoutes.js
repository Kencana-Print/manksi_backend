const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkBagian,
  checkPermission,
} = require("../../middleware/authMiddleware");
const pengajuanUangMukaController = require("../../controllers/pembelian/pengajuanUangMukaController");

const MENU_ID = 315;
const MENU_ID_PETTY = 973;

router.use(verifyToken);

router.get(
  "/",
  checkPermission(MENU_ID, "view"),
  pengajuanUangMukaController.getBrowse,
);
router.get(
  "/petty-cash",
  checkPermission(MENU_ID_PETTY, "view"),
  pengajuanUangMukaController.getBrowsePettyCash,
);
router.get(
  "/petty-cash/laci-saya",
  checkPermission(MENU_ID_PETTY, "view"),
  pengajuanUangMukaController.getInfoLaci,
);
router.post(
  "/petty-cash",
  checkPermission(MENU_ID_PETTY, "insert"),
  pengajuanUangMukaController.createPettyCash,
);
router.get(
  "/petty-cash/:nomor/validasi",
  checkPermission(MENU_ID_PETTY, "view"),
  pengajuanUangMukaController.getValidasi,
);
router.post(
  "/petty-cash/:nomor/validasi",
  checkPermission(MENU_ID_PETTY, "save"),
  checkBagian("FINANCE", "EDP", "AUDIT", "DIREKSI"),
  pengajuanUangMukaController.postValidasi,
);
router.post(
  "/petty-cash/:nomor/batal-validasi",
  checkPermission(MENU_ID_PETTY, "save"),
  checkBagian("FINANCE", "EDP", "AUDIT", "DIREKSI"),
  pengajuanUangMukaController.postBatalValidasi,
);
router.post(
  "/petty-cash/penyerahan",
  checkPermission(MENU_ID_PETTY, "insert"),
  pengajuanUangMukaController.createPenyerahan,
);
router.post(
  "/petty-cash/:nomor/batal",
  checkPermission(MENU_ID_PETTY, "save"),
  pengajuanUangMukaController.batalPenyerahan,
);
router.get(
  "/:nomor",
  checkPermission(MENU_ID, "view"),
  pengajuanUangMukaController.getDetail,
);
router.get(
  "/print/:nomor",
  verifyToken,
  pengajuanUangMukaController.getPrintData,
);
router.get(
  "/:nomor/print-penyerahan",
  verifyToken,
  pengajuanUangMukaController.getPrintPenyerahan,
);
router.get(
  "/penyelesaian/:bon/validasi",
  checkPermission(MENU_ID, "view"),
  pengajuanUangMukaController.getValidasiPenyelesaian,
);
router.post(
  "/penyelesaian/:bon/validasi",
  checkPermission(MENU_ID, "save"),
  checkBagian("FINANCE", "EDP", "AUDIT", "DIREKSI"),
  pengajuanUangMukaController.postValidasiPenyelesaian,
);
router.post(
  "/penyelesaian/:bon/batal-validasi",
  checkPermission(MENU_ID, "save"),
  checkBagian("FINANCE", "EDP", "AUDIT", "DIREKSI"),
  pengajuanUangMukaController.postBatalValidasiPenyelesaian,
);
router.get(
  "/:nomor/validasi",
  checkPermission(MENU_ID, "view"),
  pengajuanUangMukaController.getValidasi,
);
router.post(
  "/:nomor/validasi",
  checkPermission(MENU_ID, "save"),
  checkBagian("FINANCE", "EDP", "AUDIT", "DIREKSI"),
  pengajuanUangMukaController.postValidasi,
);
router.post(
  "/:nomor/batal-validasi",
  checkPermission(MENU_ID, "save"),
  checkBagian("FINANCE", "EDP", "AUDIT", "DIREKSI"),
  pengajuanUangMukaController.postBatalValidasi,
);
router.post(
  "/",
  checkPermission(MENU_ID, "insert"),
  pengajuanUangMukaController.create,
);

module.exports = router;
