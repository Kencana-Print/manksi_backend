const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/bpbNonBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 67; // BPB Non Bahan

router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getDetailForm,
);
router.get(
  "/permintaan/:mbNomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getPermintaanDetail,
);
router.get(
  "/po/:poNomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getPoDetail,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.saveData,
);

module.exports = router;
