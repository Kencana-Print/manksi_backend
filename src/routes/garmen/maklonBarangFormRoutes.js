const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/maklonBarangFormController");
const upload = require("../../middleware/uploadMiddleware");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 181;

router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  controller.save,
);
router.post(
  "/upload-gambar",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  upload.array("images", 10),
  controller.uploadGambar,
);
router.get(
  "/cabang-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangOptions,
);
router.get(
  "/:nomor/sj-keluar-dialog",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSjKeluarDialog,
);
router.post(
  "/:nomor/sj-keluar",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  controller.createSjKeluar,
);
router.get(
  "/sj-keluar/:sjkNomor/print",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSjKeluarPrintData,
);

// ⚠️ Wildcard PALING AKHIR
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);

module.exports = router;
