const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const pengajuanUangMukaController = require("../../controllers/pembelian/pengajuanUangMukaController");

const MENU_ID = 315;

router.use(verifyToken);

router.get(
  "/",
  checkPermission(MENU_ID, "view"),
  pengajuanUangMukaController.getBrowse,
);
router.get(
  "/:nomor",
  checkPermission(MENU_ID, "view"),
  pengajuanUangMukaController.getDetail,
);
router.post(
  "/",
  checkPermission(MENU_ID, "insert"),
  pengajuanUangMukaController.create,
);

module.exports = router;
