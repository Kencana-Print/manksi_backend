const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/pemakaianObatFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "120";

// Route statis WAJIB sebelum route dinamis
router.get(
  "/meta",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getMeta,
);
router.get(
  "/spk/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.resolveSpk,
);
router.get(
  "/komponen/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.resolveKomponen,
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
  controller.getFormData,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

module.exports = router;
