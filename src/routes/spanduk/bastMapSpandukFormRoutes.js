const express = require("express");
const router = express.Router();
const controller = require("../../controllers/spanduk/bastMapSpandukFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Statis dulu, dinamis (/:nomor) terakhir
router.get(
  "/lookups/map",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupMap,
);
router.get(
  "/lookups/bahan",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupBahan,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(4, "view"),
  controller.getPrint,
);

router.post("/", verifyToken, checkPermission(4, "insert"), controller.create);
router.put(
  "/:nomor/keputusan",
  verifyToken,
  checkPermission(4, "edit"),
  controller.setKeputusan,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(4, "view"),
  controller.getById,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(4, "edit"),
  controller.update,
);

module.exports = router;
