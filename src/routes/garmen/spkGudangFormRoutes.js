const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/spkGudangFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 79;

router.get(
  "/lookup-jenis-kain/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupJenisKain,
);
router.get(
  "/search-barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchBarcode,
);
router.get(
  "/resolve-barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.resolveBarcode,
);
router.get(
  "/search-bahan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchBahan,
);
router.get(
  "/lookup-warna",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupWarna,
);
router.get(
  "/search-jenis-kain-kaosan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchJenisKainKaosan,
);
router.get(
  "/search-warna",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchWarna,
);
router.get(
  "/search-jenis-kain",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchJenisKain,
);
router.get(
  "/lengan-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLenganList,
);
router.get(
  "/cetak/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDataCetak,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

module.exports = router;
