const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");
const kartuStokKainController = require("../../../controllers/laporan/spanduk/kartuStokKainController");

router.use(verifyToken);

router.get(
  "/",
  checkPermission(963, "view"),
  kartuStokKainController.getBrowse,
);
router.get(
  "/detail",
  checkPermission(963, "view"),
  kartuStokKainController.getDetail,
);
router.get(
  "/gudang",
  checkPermission(963, "view"),
  kartuStokKainController.getGudang,
);

module.exports = router;
