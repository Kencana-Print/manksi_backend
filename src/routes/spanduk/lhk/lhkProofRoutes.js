const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkProofController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID_PROOF = 4; // ISI: menu_id LHK Proof (belum saya ketahui)

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID_PROOF, "view"),
  controller.getBrowse,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID_PROOF, "view"),
  controller.getDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID_PROOF, "delete"),
  controller.remove,
);

module.exports = router;
