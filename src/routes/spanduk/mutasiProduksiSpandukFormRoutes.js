const express = require("express");
const router = express.Router();
const controller = require("../../controllers/spanduk/mutasiProduksiSpandukFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Statis dulu, dinamis (/:nomor) terakhir
router.get(
  "/lookups/lini-asal",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupLiniAsal,
);
router.get(
  "/lookups/lini-tujuan",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupLiniTujuan,
);
router.get(
  "/lookups/pabrik",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupPabrik,
);
router.get(
  "/lookups/lhk",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupLhk,
);
router.get(
  "/lookups/lhk-spk",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupSpkDiLhk,
);

router.post("/", verifyToken, checkPermission(4, "insert"), controller.create);
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
router.get(
  "/lookups/hasil-lhk",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupHasilLhk,
);

module.exports = router;
