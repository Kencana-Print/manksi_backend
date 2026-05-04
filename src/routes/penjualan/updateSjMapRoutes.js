const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/updateSjMapController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "164";

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get("/status-options", verifyToken, controller.getOptions);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateStatus,
);

router.get("/:nomor", verifyToken, controller.getDetail);

module.exports = router;
