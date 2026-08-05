const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/approveReturBarangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "63";

router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

router.get(
  "/:logNomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getApprovalDetail,
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.saveApproval,
);

router.delete(
  "/:noApprov",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.cancelApproval,
);

module.exports = router;
