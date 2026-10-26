const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkLipatController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Static route dulu sebelum route dinamis (/:nomor)
router.get(
  "/",
  verifyToken,
  checkPermission(1223, "view"),
  controller.getBrowse,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(1223, "view"),
  controller.getDetail,
);
router.get(
  "/karyawan",
  verifyToken,
  checkPermission(1223, "view"),
  controller.getKaryawan,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(1223, "delete"),
  controller.hapus,
);

module.exports = router;
