const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkQuiringController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Static route dulu sebelum route dinamis (/:nomor)
router.get(
  "/",
  verifyToken,
  checkPermission(1224, "view"),
  controller.getBrowse,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(1224, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(1224, "delete"),
  controller.hapus,
);

module.exports = router;
