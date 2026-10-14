const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkQuiringFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Static route dulu sebelum route dinamis (/:nomor)
router.get(
  "/lookups/pabrik",
  verifyToken,
  checkPermission(1224, "view"),
  controller.lookupPabrik,
);
router.get(
  "/info-spk/:nomor",
  verifyToken,
  checkPermission(1224, "view"),
  controller.infoSpk,
);
router.post(
  "/",
  verifyToken,
  checkPermission(1224, "insert"),
  controller.create,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(1224, "view"),
  controller.getById,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(1224, "edit"),
  controller.update,
);

module.exports = router;
