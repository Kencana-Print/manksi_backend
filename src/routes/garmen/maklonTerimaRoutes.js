// routes/garmen/maklonTerimaRoutes.js
const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/garmen/maklonTerimaController");

const MENU_ID = 181;

router.use(verifyToken);
router.get(
  "/by-mkl/:mklNomor",
  checkPermission(MENU_ID, "view"),
  ctrl.getOutstandingByMkl,
);
router.post("/", checkPermission(MENU_ID, "insert"), ctrl.save);

module.exports = router;
