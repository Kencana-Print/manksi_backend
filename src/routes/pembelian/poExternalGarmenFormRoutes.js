const express = require("express");
const router = express.Router();
const controller = require("../../controllers/pembelian/poExternalGarmenFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 144;

// Rute spesifik WAJIB di atas "/:nomor" biar ga ketangkep sbg param
router.get(
  "/init",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getFormInit,
);
router.get(
  "/spk/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getSpkDetail,
);
router.get(
  "/supplier/:kode",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getSupplierDetail,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.save,
);
router.get(
  "/:nomor/cetak",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getCetak,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getForm,
);

module.exports = router;
