const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/praOrderController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 175;

// Lookup
router.get("/divisi", verifyToken, controller.getDivisi);

// Browse
router.get(
  "/browse",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowseData,
);

// Delete
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "delete"),
  controller.deleteData,
);

// Pengajuan Edit (PIN5)
router.get(
  "/pengajuan/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.getPengajuanEditStatus,
);
router.post(
  "/pengajuan/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.submitPengajuan,
);

module.exports = router;
