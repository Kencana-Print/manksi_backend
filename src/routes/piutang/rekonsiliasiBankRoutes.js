const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/rekonsiliasiBankController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "957";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.delete(
  "/:rekKode",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

router.get(
  "/:rekKode/validasi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getValidasi,
);
router.post(
  "/:rekKode/validasi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.saveValidasi,
);

router.get(
  "/:rekKode/rekon",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getRekon,
);
router.post(
  "/:rekKode/rekon",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.saveRekon,
);

module.exports = router;
