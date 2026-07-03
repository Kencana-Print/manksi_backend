const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/invoiceTakNormalFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "158";

router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

router.get(
  "/search-barang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchBarang,
);
router.get(
  "/barang-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.loadBarangDetail,
);

router.get(
  "/search-perusahaan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchPerusahaan,
);
router.get(
  "/customer-info",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getCustomerInfo,
);
router.get(
  "/rekening",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getRekeningPerush,
);
router.get(
  "/divisi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDivisiList,
);

// F1 (spanduk) / F4 (garmen) — cari Invoice Normal utk dinaungi
router.get(
  "/invoice-normal-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getInvoiceNormalList,
);
router.get(
  "/validate-invoice-normal",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.validateInvoiceNormal,
);

router.get(
  "/data-cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetak,
);

router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);

module.exports = router;
