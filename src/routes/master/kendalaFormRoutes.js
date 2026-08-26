const express = require("express");
const router = express.Router();
const upload = require("../../middleware/uploadMiddleware");
const controller = require("../../controllers/master/kendalaFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 37;

const imageUploadFields = upload.fields([
  { name: "image1", maxCount: 1 },
  { name: "image2", maxCount: 1 },
  { name: "image3", maxCount: 1 },
]);

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
  imageUploadFields,
  controller.save,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  imageUploadFields,
  controller.save,
);
router.post(
  "/reset-images",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.resetImages,
);

module.exports = router;
