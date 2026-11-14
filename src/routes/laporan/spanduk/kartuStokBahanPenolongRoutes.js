const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");
const kartuStokBahanPenolongController = require("../../../controllers/laporan/spanduk/kartuStokBahanPenolongController");

router.use(verifyToken);

router.get(
  "/",
  checkPermission(963, "view"),
  kartuStokBahanPenolongController.getBrowse,
);
router.get(
  "/detail",
  checkPermission(963, "view"),
  kartuStokBahanPenolongController.getDetail,
);
router.get(
  "/cabang",
  checkPermission(963, "view"),
  kartuStokBahanPenolongController.getCabang,
);

module.exports = router;
