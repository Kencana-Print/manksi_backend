const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/praSuratJalanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "168";

router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

// POST karena butuh kirim array existingRows di body
router.post(
  "/detail-so",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailSo,
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
  "/alokasi-history",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAlokasiHistory,
);
router.get(
  "/divisi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDivisiList,
);

router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);

module.exports = router;
