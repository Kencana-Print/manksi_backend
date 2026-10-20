const express = require("express");
const router = express.Router();
const controller = require("../../controllers/tools/notulensiMeetingController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 1328;

// Route statis di atas route dinamis (/:nomor)
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseList,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getExportDetail,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

module.exports = router;
