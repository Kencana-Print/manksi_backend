const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/approveReturBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "137";

// GET Detail (Untuk Load Form)
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

// POST Simpan / Approve
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

module.exports = router;
