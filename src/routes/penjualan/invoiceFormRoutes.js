const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/invoiceFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "156";

router.get(
  "/divisi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDivisiList,
);
router.get(
  "/customer-info",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getCustomerInfo,
);
router.get(
  "/validate-invpro",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.validateInvPro,
);
router.get(
  "/rekening",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getRekeningPerush,
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
  "/cek-pelunasan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekStatusPelunasan,
);
router.get(
  "/cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetak,
);
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getById);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);

module.exports = router;
