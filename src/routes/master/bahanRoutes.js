const express = require("express");
const router = express.Router();
const bahanController = require("../../controllers/master/bahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 11;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  bahanController.getBrowseBahan,
);
router.get("/lookups/:category", verifyToken, bahanController.getLookups);
router.get(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "view"),
  bahanController.getBahanById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  bahanController.createBahan,
);
router.put(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "edit"),
  bahanController.updateBahan,
);
router.delete(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "delete"),
  bahanController.deleteBahan,
);

module.exports = router;
