const express = require("express");
const router = express.Router();
const controller = require("../../controllers/piutang/pelunasanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Pengambilan info pendukung form (View permission)
router.get(
  "/info-invoice",
  verifyToken,
  checkPermission(255, "view"),
  controller.getInfoInvoice,
);
router.get(
  "/info-pembayaran",
  verifyToken,
  checkPermission(255, "view"),
  controller.getInfoPembayaran,
);
router.get(
  "/:nomor/print",
  verifyToken,
  checkPermission(255, "view"),
  controller.getPrintData,
);

// Pengambilan data form edit
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(255, "view"),
  controller.getFormEditData,
);

// Simpan data form (Bisa insert atau update, validasinya digabung dalam service dan auth)
router.post(
  "/",
  verifyToken,
  checkPermission(255, "insert"),
  controller.saveFormPelunasan,
);
router.put(
  "/",
  verifyToken,
  checkPermission(255, "edit"),
  controller.saveFormPelunasan,
);

module.exports = router;
