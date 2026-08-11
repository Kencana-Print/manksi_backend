const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/cetakBarcodeKaosanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "130";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
