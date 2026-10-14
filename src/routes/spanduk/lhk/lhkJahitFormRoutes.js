const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkJahitFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Static route dulu sebelum route dinamis (/:nomor)
router.get(
  "/lookups/pabrik",
  verifyToken,
  checkPermission(1222, "view"),
  controller.lookupPabrik,
);
router.get(
  "/lookups/karyawan",
  verifyToken,
  checkPermission(1222, "view"),
  controller.lookupKaryawan,
);
router.get(
  "/info-spk/:nomor",
  verifyToken,
  checkPermission(1222, "view"),
  controller.infoSpk,
);
router.post(
  "/",
  verifyToken,
  checkPermission(1222, "insert"),
  controller.create,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(1222, "view"),
  controller.getById,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(1222, "edit"),
  controller.update,
);

module.exports = router;
