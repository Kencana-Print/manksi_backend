const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ppic/proofFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 122;

// Rute statis WAJIB di atas '/:nomor' generik.
router.get(
  "/meta",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getMeta,
);
router.get(
  "/lookup/search-spk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchSpk,
);
router.get(
  "/lookup/spk-info/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkInfo,
);
router.get(
  "/lookup/check-duplikat",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.checkDuplikat,
);
router.get(
  "/lookup/search-nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchNomor,
);
router.get(
  "/lookup/load-bahan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.loadBahan,
);
router.get(
  "/lookup/search-bahan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchBahan,
);

router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.put("/:nomor", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.save);

module.exports = router;
