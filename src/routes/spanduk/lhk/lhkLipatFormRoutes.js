const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkLipatFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Static route dulu sebelum route dinamis (/:nomor)
router.get(
  "/lookups/pabrik",
  verifyToken,
  checkPermission(1223, "view"),
  controller.lookupPabrik,
);
router.get(
  "/lookups/karyawan",
  verifyToken,
  checkPermission(1223, "view"),
  controller.lookupKaryawan,
);
router.get(
  "/info-spk/:nomor",
  verifyToken,
  checkPermission(1223, "view"),
  controller.infoSpk,
);
router.post(
  "/",
  verifyToken,
  checkPermission(1223, "insert"),
  controller.create,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(1223, "view"),
  controller.getById,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(1223, "edit"),
  controller.update,
);

module.exports = router;
