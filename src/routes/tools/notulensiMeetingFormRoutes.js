const express = require("express");
const router = express.Router();
const controller = require("../../controllers/tools/notulensiMeetingFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 1328;

// Route statis di atas route dinamis (/:nomor)
router.get(
  "/lookups/bagian",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLookupBagian,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);
router.get(
  "/:nomor/cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCetak,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);
router.patch(
  "/:nomor/status",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateStatus,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

module.exports = router;
