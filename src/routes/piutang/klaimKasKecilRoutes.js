const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/klaimKasKecilController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "971";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);
router.put(
  "/:nomor/batal",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.batalKlaim,
);

module.exports = router;
