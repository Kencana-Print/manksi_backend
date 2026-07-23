const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/returBeliBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 55;

router.get(
  "/default",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDefaultForm,
);
router.get(
  "/bpb/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBpb,
);
router.get(
  "/barcode/:barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBarcode,
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
