const express = require("express");
const router = express.Router();
const userController = require("../../controllers/tools/userController");
const {
  verifyToken,
  requireAdmin,
} = require("../../middleware/authMiddleware");

// Hanya ADMIN/DEVELOPER yang bisa akses, jadi panggil middleware requireAdmin
router.get("/", verifyToken, requireAdmin, userController.getBrowse);
router.get("/:kode", verifyToken, requireAdmin, userController.getById);

module.exports = router;
