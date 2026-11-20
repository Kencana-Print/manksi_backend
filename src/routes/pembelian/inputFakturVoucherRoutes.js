const express = require("express");
const router = express.Router();
// Salin dua baris require middleware ini dari route yang sudah ada
// (mis. routes/pembelian/pengajuanTransferRoutes.js), path-nya tidak saya lihat.
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/pembelian/inputFakturVoucherController");

const MENU_ID = 974;

router.use(verifyToken);

router.get("/", checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.post("/simpan", checkPermission(MENU_ID, "save"), ctrl.simpanFaktur);

module.exports = router;
