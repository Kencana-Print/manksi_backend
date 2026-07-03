const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/komponenSpkFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 18;

router.get(
  "/load",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getLoadData,
);
router.get("/lookup-bahan", verifyToken, controller.getLookupBahan);
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.saveForm,
);

module.exports = router;
