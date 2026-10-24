const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkProofFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const menuId = 4;

// Static dulu, baru dynamic
router.get(
  "/lookups/pabrik",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getLookupPabrik,
);
router.get(
  "/lookups/ukuran",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getLookupUkuran,
);
router.get(
  "/spk/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getInfoSpk,
);
router.get(
  "/lookups/resep",
  verifyToken,
  checkPermission(4, "view"),
  controller.getLookupResep,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.create,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.update,
);

module.exports = router;
