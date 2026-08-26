const express = require("express");
const router = express.Router();
const controller = require("../../controllers/tools/agendaPicController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 1324;

router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getPicList,
);
router.get(
  "/candidates",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getCandidateUsers,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.addPic,
);
router.delete(
  "/:userKode",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.removePic,
);

module.exports = router;
