const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/ga/penggunaController");

const MENU_ID = 602;

router.get("/generate-kode", verifyToken, ctrl.getMaxKode);

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAll,
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.create,
);

router.get(
  "/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

router.put(
  "/:kode",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

router.delete(
  "/:kode",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
