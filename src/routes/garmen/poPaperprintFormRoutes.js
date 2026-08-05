const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/poPaperprintFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware");

const MENU_ID = "103";

router.get(
  "/meta",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getMeta,
);
router.get(
  "/supplier/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.resolveSupplier,
);
router.get(
  "/spk/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.resolveSpk,
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  upload.any(),
  controller.create,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getFormData,
);

router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  upload.any(),
  controller.update,
);

module.exports = router;
