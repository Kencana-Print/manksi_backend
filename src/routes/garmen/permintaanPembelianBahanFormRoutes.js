const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/permintaanPembelianBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 190;

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.getForEdit,
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);

router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

module.exports = router;
