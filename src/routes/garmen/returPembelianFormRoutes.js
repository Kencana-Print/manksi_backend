const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/returPembelianFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "68";

router.get(
  "/search-bpb",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchBpb,
);
router.get(
  "/resolve-bpb",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.resolveBpb,
);
router.get(
  "/cetak/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDataCetak,
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
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getFormData,
);

module.exports = router;
