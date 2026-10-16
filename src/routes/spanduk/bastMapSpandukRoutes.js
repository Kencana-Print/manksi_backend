const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const c = require("../../controllers/spanduk/bastMapSpandukController");

const MENU_ID = 4; // belum dikonfirmasi

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), c.getBrowse);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  c.remove,
);

module.exports = router;
