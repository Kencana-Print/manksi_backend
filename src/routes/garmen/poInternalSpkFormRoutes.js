const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/poInternalSpkFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 124;

// ⚠️ Route param ("/:nomor") WAJIB paling akhir supaya tidak
// "menelan" route statis di atasnya (default-gudang, check-*, dst).
router.get(
  "/default-gudang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDefaultGudang,
);

router.get(
  "/check-pabrik",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkPabrik,
);

router.get(
  "/check-spk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkSpk,
);

router.get(
  "/check-jasa",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkJasa,
);

router.post(
  "/load-bahan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.loadBahan,
);

router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);

module.exports = router;
