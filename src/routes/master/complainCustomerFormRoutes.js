const express = require("express");
const router = express.Router();
const upload = require("../../middleware/uploadMiddleware");
const controller = require("../../controllers/master/complainCustomerFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 36; // Complain Customer

router.get(
  "/jenis-complain",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getJenisComplain,
);
router.get(
  "/spk-detail/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getSpkDetail,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getDetail,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.save,
);
router.post(
  "/upload-image",
  verifyToken,
  checkPermission(menuId, "edit"),
  upload.single("gambar"),
  controller.uploadImage,
);
router.post(
  "/reset-images",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.resetImages,
);

module.exports = router;
