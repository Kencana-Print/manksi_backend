// suratJalanMap.routes.js
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;
const express = require("express");
const router = express.Router();
router.use(verifyToken);
const sjMapController = require("../../../../controllers/mmt/transaksi-khusus/pengiriman/suratJalanMapController");

// Get List Master Surat Jalan MAP (Query: ?startDate=...&endDate=...&canLihatCus=...)
router.get("/", verifyToken, sjMapController.browseSjMap);

// Get Detail Surat Jalan MAP berdasarkan Nomor SJ (Query: ?nomor=...)
router.get("/detail", verifyToken, sjMapController.getDetailSjMapByNomor);

// Cek Urutan Pengajuan Edit Terakhir
router.get(
  "/pengajuan/urut/:nomor",
  verifyToken,
  sjMapController.getUrutPengajuanMap,
);

// Cek Status PIN 5 Terakhir
router.get("/pin5/:nomor", verifyToken, sjMapController.getPin5StatusMap);

// Submit Form Pengajuan Edit Perubahan Data
router.post("/pengajuan", verifyToken, sjMapController.submitPengajuanMap);

// Hapus Surat Jalan MAP
router.delete("/:nomor", verifyToken, sjMapController.deleteSjMap);

module.exports = router;
