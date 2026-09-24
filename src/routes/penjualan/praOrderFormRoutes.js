// routes/penjualan/praOrderFormRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/praOrderFormController");
const upload = require("../../middleware/uploadMiddleware");
const {
  verifyToken,
  checkPermission,
  checkBagian,
} = require("../../middleware/authMiddleware");

const menuId = 175;

router.get("/init-grids", verifyToken, controller.getInitGrids);
router.get(
  "/katalog/customer/:custKode",
  verifyToken,
  controller.getKatalogCustomer,
);
router.get("/search", verifyToken, controller.searchPraOrder);
router.get("/lookup/:nomor", verifyToken, controller.getLookupData);

// ⬅ DIUBAH: path relatif (bukan "/pra-order-form/copy-image/...") —
// file ini sudah di-mount di bawah prefix /penjualan/pra-order-form
// di app.js/index.js, jadi prefix itu tidak perlu diulang di sini.
// Ditaruh SEBELUM "/:nomor" supaya tidak ketabrak generic param route,
// meski secara method (POST vs GET) sebenarnya tidak akan konflik.
router.post(
  "/copy-image/:proNomor/:mhNomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.copyImageToMintaHarga,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getById,
);
router.post("/", verifyToken, checkPermission(menuId, "save"), controller.save);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.save,
);
router.post(
  "/:nomor/gambar",
  verifyToken,
  checkPermission(menuId, "edit"),
  upload.array("files", 10),
  controller.uploadGambar,
);

// ── Aksi khusus PPIC ──
router.patch(
  "/bahan/:prob_id/status",
  verifyToken,
  checkPermission(menuId, "edit"),
  checkBagian("PPIC"),
  controller.setStatusBahan,
);
router.patch(
  "/:nomor/status-ppic",
  verifyToken,
  checkPermission(menuId, "edit"),
  checkBagian("PPIC"),
  controller.setStatusPpic,
);

router.post(
  "/:nomor/convert-mh",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.convertToMintaHarga,
);

module.exports = router;
