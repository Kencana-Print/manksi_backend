const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/permintaanMarkerController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 189;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.get(
  "/menunggu-validasi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getMenungguValidasi,
);
router.get(
  "/:nomor/tanda-terima",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.listTandaTerima,
);
router.post(
  "/tanda-terima/:ttNomor/validasi",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.validasiTandaTerima,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
