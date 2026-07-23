const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/pembuatanBarcodeBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 135;

router.get(
  "/default",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDefaultForm,
);
router.get(
  "/barang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBarang,
);
router.post(
  "/generate-roll",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.generateBarcodesForRoll,
);
router.get(
  "/bpb-retur/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBpbOrRetur,
);
router.get(
  "/cetak-single",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSingleBarcodeCetak,
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
router.post(
  "/save-row-qty",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveRowQty,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

module.exports = router;
