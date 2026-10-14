const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkPlotterFormController");
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
  "/spk/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getInfoSpk,
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
