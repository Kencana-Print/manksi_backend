// routes/ppic/penjadwalanPpicRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/ppic/penjadwalanPpicController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 176;

router.get(
  "/browse",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get(
  "/riwayat-kirim",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getRiwayatKirim,
);
router.get(
  "/notif-map",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getUnnotifiedMap,
);
router.get(
  "/notif-so",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getUnnotifiedSo,
);
router.post(
  "/notif-so/mark-read",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.markSoNotified,
);
router.post(
  "/notif-map/mark-read",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.markMapNotified,
);
router.get(
  "/:nomor/pencapaian",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getPencapaian,
);
router.put(
  "/:nomor/pencapaian",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.savePencapaian,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getDetail,
);
router.put(
  "/:nomor/close",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.toggleClose,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.deleteData,
);

module.exports = router;
