const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/sjTakNormalFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "154";

router.get(
  "/check-nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.checkNomor,
);
router.get(
  "/barang-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.loadBarangDetail,
);
router.get(
  "/spk-customer",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkCustomer,
);
router.get(
  "/customer-info",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getCustomerInfo,
);
router.get(
  "/search-perusahaan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchPerusahaan,
);
router.get(
  "/divisi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDivisiList,
);
router.get(
  "/search-barang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchBarang,
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
