const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/ga/kendaraanController");

const MENU_ID = 601;

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
  "/:nopol",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

router.put(
  "/:nopol",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

router.delete(
  "/:nopol",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
