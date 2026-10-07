const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/permintaanDesainController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 184; // ID Menu Permintaan Desain

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/search",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchReferensi,
);
router.put(
  "/:nomor/status",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.setStatusManual,
);
router.put(
  "/:nomor/resume",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.resumeStatus,
);
router.put(
  "/:nomor/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.closePD,
);
router.put(
  "/:nomor/buka-kembali",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.bukaKembali,
);
router.get(
  "/desainer-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDesainerOptions,
);
router.get(
  "/antrean",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getAntrean,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.put(
  "/:nomor/desainer",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateDesainer,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateHeader,
);
router.post(
  "/detail/:pd2Id/kerja",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.mulaiKerja,
);
router.post(
  "/kerja/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.closeKerja,
);
router.put(
  "/kerja/:kerjaId",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateKerja,
);
router.delete(
  "/kerja/:kerjaId",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.batalKerja,
);
router.post(
  "/kerja/:kerjaId/ambil-alih",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.ambilAlih,
);

module.exports = router;
