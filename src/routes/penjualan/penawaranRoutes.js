const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/penawaranController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 151; // ID Menu Penawaran

// Route Browse Utama (Master)
router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseList,
);

// Route Browse Detail (Expanded Row)
router.get(
  "/browse/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseDetail,
);

// Route Delete
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

router.put(
  "/status/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateStatus,
);

module.exports = router;
