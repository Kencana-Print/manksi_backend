const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/bapProduksiController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID 142 = BAP dan Komplain Produksi
const menuId = 142;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get(
  "/reviewed/baru",
  verifyToken,
  controller.getBapReviewedUntukPembuat,
);
router.post("/reviewed/dibaca", verifyToken, controller.reviewDibaca);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.remove,
);

// Route khusus pengajuan Edit (Pin 5)
router.post(
  "/:nomor/ajukan",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.ajukanPerubahan,
);

module.exports = router;
