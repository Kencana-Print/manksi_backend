const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/koreksiStokBarangJadiFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "114";

// Route statis WAJIB sebelum route dinamis "/:nomor"
router.get(
  "/gudang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.validateGudang,
);

router.get(
  "/barang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupBarang,
);

router.get(
  "/barang-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchBarang,
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getFormData,
);

router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

module.exports = router;
