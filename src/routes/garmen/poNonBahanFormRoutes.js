const express = require("express");
const router = express.Router();
const poNonBahanFormController = require("../../controllers/garmen/poNonBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 66;

router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  poNonBahanFormController.getDetailForm,
);
router.get(
  "/permintaan/:mbNomor",
  verifyToken,
  checkPermission(menuId, "view"),
  poNonBahanFormController.getPermintaanDetail,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "insert"),
  poNonBahanFormController.saveData,
);

module.exports = router;
