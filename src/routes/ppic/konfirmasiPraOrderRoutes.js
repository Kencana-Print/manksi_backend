const express = require("express");
const router = express.Router();
const controller = require("../../controllers/ppic/konfirmasiPraOrderController");
const {
  verifyToken,
  checkPermission,
  checkBagian,
} = require("../../middleware/authMiddleware");

const menuId = 1325;

router.get("/divisi", verifyToken, controller.getDivisi);
router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getDetail,
);
router.patch(
  "/:nomor/konfirmasi",
  verifyToken,
  checkPermission(menuId, "edit"),
  checkBagian("PPIC"),
  controller.confirmKesanggupan,
);
router.patch(
  "/bahan/:probId/status",
  verifyToken,
  checkPermission(menuId, "edit"),
  checkBagian("PPIC"),
  controller.confirmStatusBahan,
);

module.exports = router;
