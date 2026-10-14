const express = require("express");
const router = express.Router();
const controller = require("../../controllers/spanduk/mutasiProduksiSpandukController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

router.get("/", verifyToken, checkPermission(4, "view"), controller.getBrowse);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(4, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(4, "delete"),
  controller.hapus,
);

module.exports = router;
