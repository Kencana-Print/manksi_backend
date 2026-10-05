const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/permintaanDesainLampiranController");
const upload = require("../../middleware/uploadMiddleware");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 184;

router.get(
  "/:nomor/lampiran",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLampiran,
);
router.post(
  "/:nomor/lampiran",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  upload.array("files", 5),
  controller.addLampiran,
);
router.delete(
  "/lampiran/:id",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.deleteLampiran,
);

module.exports = router;
