const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/returQcFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 55;

router.get(
  "/qc-siap",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getQcSiap,
);
router.get(
  "/lot",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLotReject,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getFormData,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

module.exports = router;
