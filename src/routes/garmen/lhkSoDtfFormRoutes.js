const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/lhkSoDtfFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "123";

// Static routes DULU sebelum dynamic ':kode'
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.get(
  "/default-cab",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.getDefaultCab,
);
router.get(
  "/lookup-spk-map",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupSpkMap,
);
router.get(
  "/lookup-so-dtf",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupSoDtf,
);
router.get(
  "/lookup-maklon",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupMaklon,
);
router.get(
  "/validate-maklon/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.validateMaklonKode,
);
router.get(
  "/maklon-autofill/:mklNomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getMaklonAutofill,
);
router.get(
  "/validate-kode/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.validateKode,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

module.exports = router;
