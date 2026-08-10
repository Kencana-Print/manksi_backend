const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/lhkSoDtfController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "123";

// Static routes DULU sebelum dynamic ':spkNomor/:cab/:tanggal'
router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/default-create",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.getDefaultForCreate,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);
router.put(
  "/:spkNomor/:cab/:tanggal",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);
router.delete(
  "/:spkNomor/:cab/:tanggal",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove,
);

module.exports = router;
