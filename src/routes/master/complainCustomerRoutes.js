const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/complainCustomerController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 36; // Complain Customer

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.deleteComplain,
);

module.exports = router;
