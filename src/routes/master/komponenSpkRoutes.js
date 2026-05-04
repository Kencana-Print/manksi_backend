const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/komponenSpkController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID 18 = Identitas Komponen SPK
const menuId = 18;

// Browse Master (Perhatikan query parameternya akan dikirim dari frontend)
router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);

// Detail (Expanded Row)
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getDetail,
);

module.exports = router;
