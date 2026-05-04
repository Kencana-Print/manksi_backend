const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/stdOutputController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID 29 = Standart Output per Hari
const menuId = 29;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
// Karena tabel ini unik tanpa primary key (hanya 1 baris), kita tidak perlu parameter /:id
router.put(
  "/",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.update,
);

module.exports = router;
