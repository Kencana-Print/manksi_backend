const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/returPembelianBarangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "68";

router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

router.post(
  "/pengajuan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestEdit,
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

module.exports = router;
