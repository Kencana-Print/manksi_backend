const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/cetakBarcodeKaosanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "130";

router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

router.get(
  "/search-kaosan-master",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchKaosanMaster,
);

router.get(
  "/lookup-spk/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.lookupSpk,
);

router.get(
  "/lookup-kaosan/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.lookupKodeKaosan,
);

router.get(
  "/lookup-barcode/:barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.lookupByBarcode,
);

// Preview BS membuat kode di retail → wajib izin tambah/ubah. Preview biasa tetap "view".
const izinPreview = (req, res, next) => {
  const aksi = req.body?.bs ? (req.body?.nomor ? "edit" : "insert") : "view";
  return checkPermission(MENU_ID, aksi)(req, res, next);
};

router.post("/preview-print", verifyToken, izinPreview, ctrl.previewPrint);

router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.save,
);
router.put("/save", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.save);

module.exports = router;
