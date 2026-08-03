const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/salesOrderController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 172;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteOrder,
);
router.put(
  "/:nomor/toggle-close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.toggleClose,
);
router.post(
  "/:nomor/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin,
);
router.get(
  "/:nomor/sizes",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSizes,
);
// Rute APPROVAL CMO
// Menggunakan PUT karena ini adalah aksi merubah/meng-update status
router.put(
  "/:nomor/approve",
  verifyToken,
  checkPermission(MENU_ID, "edit"), // Biasanya disamakan dengan hak edit atau hak spesifik
  controller.approveCmo,
);

router.get(
  "/pending-design",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPendingDesigns,
);
router.put(
  "/update-design",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateDesignStatus,
);

router.get(
  "/pembatalan-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPembatalanDetail,
);
router.post(
  "/pembatalan-ajukan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.ajukanPembatalan,
);

router.get(
  "/ganti-qty-kain-status",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getGantiQtyKainStatus,
);
router.post(
  "/ganti-qty-kain-ajukan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.ajukanGantiQtyKain,
);

module.exports = router;
