const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/koreksiStokBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 115;

router.get(
  "/default",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDefaultForm,
);
router.get(
  "/gudang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getGudang,
);
router.get(
  "/barang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBarang,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getFormData,
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
