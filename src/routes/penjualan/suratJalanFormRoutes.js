const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/suratJalanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "153";

router.get(
  "/divisi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDivisiList,
);
router.get(
  "/spk-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkList,
);
router.post(
  "/spk-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkDetail,
);
router.get(
  "/jadwal-kirim",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getJadwalKirimList,
);
router.get(
  "/cek-piutang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekPiutang,
);
router.get(
  "/alokasi-history",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAlokasiHistory,
);
router.get(
  "/alokasi-spk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAlokasiSpk,
);
router.get(
  "/inv-proforma",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getInvProformaList,
);
router.get(
  "/rekening",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getRekeningPerush,
);
router.get(
  "/cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetak,
);
router.get(
  "/kode-otorisasi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getKodeOtorisasi,
);
router.post(
  "/otorisasi",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.submitOtorisasi,
);
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getById);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);

module.exports = router;
