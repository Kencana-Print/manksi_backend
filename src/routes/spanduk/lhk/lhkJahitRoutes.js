const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkJahitController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Static route dulu sebelum route dinamis (/:nomor)
router.get(
  "/",
  verifyToken,
  checkPermission(1222, "view"),
  controller.getBrowse,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(1222, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(1222, "delete"),
  controller.hapus,
);

module.exports = router;
