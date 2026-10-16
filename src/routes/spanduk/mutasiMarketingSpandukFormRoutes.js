const express = require("express");
const router = express.Router();
const controller = require("../../controllers/spanduk/mutasiMarketingSpandukFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 1327;

// Route statis dulu, baru dinamis
router.get(
  "/lookups/map",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupMap,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrint,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

module.exports = router;
