const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkDesignController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

router.get("/", verifyToken, checkPermission(4, "view"), controller.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(4, "view"),
  controller.getDetail,
);
router.get(
  "/status",
  verifyToken,
  checkPermission(4, "view"),
  controller.getStatus,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(4, "delete"),
  controller.remove,
);

module.exports = router;
