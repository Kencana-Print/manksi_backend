const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/lhkPolaFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 174;

// Rute statis WAJIB di atas '/:nomor' generik.
router.get(
  "/lookup/search-spk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchSpk,
);
router.get(
  "/lookup/spk/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSpkByNomor,
);

router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.remove,
);

module.exports = router;
