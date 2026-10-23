const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkDesignFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Rute statis dulu, sebelum rute dinamis /:nomor
router.get(
  "/lookup/spk",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupSpk,
);
router.get(
  "/lookup/designer",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupDesigner,
);
router.get(
  "/lookup/mesin",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupMesin,
);
router.get(
  "/lookup/bahan",
  verifyToken,
  checkPermission(4, "view"),
  controller.lookupBahan,
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
  controller.simpan,
);
router.post(
  "/:nomor/mulai",
  verifyToken,
  checkPermission(4, "edit"),
  controller.mulai,
);
router.post(
  "/:nomor/selesai",
  verifyToken,
  checkPermission(4, "edit"),
  controller.selesai,
);

module.exports = router;
