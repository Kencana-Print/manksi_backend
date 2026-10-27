const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/spanduk/monitoringProofFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Menu parent Laporan > Produksi Spanduk = 963 (izin dicek di parent)
// Route statis harus di atas "/:nomor"
router.get(
  "/gudang",
  verifyToken,
  checkPermission(963, "view"),
  controller.getGudangProof,
);
router.get(
  "/daftar-map",
  verifyToken,
  checkPermission(963, "view"),
  controller.getDaftarMap,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(963, "view"),
  controller.getForm,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(963, "edit"),
  controller.simpan,
);

module.exports = router;
