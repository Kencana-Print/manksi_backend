const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkBagian,
  checkPermission,
} = require("../../middleware/authMiddleware");
const pengajuanUangMukaController = require("../../controllers/pembelian/pengajuanUangMukaController");

const MENU_ID = 315;

router.use(verifyToken);

router.get(
  "/",
  checkPermission(MENU_ID, "view"),
  pengajuanUangMukaController.getBrowse,
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
