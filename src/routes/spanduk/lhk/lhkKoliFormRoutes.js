const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkKoliFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

router.get(
  "/lookups/pabrik",
  verifyToken,
  checkPermission(4, "view"),
  controller.getLookupPabrik,
);
router.get(
  "/spk/:nomor",
  verifyToken,
  checkPermission(4, "view"),
  controller.getInfoSpk,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(4, "view"),
  controller.getPrint,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(4, "view"),
  controller.getById,
);
router.post("/", verifyToken, checkPermission(4, "insert"), controller.create);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(4, "edit"),
  controller.update,
);

module.exports = router;
