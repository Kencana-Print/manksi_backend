const express = require("express");
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken; // Sesuaikan jika ada middleware auth
const router = express.Router();
router.use(verifyToken);
const sjController = require("../../../../controllers/mmt/transaksi-khusus/pengiriman/suratJalanController");

// ==========================================
// 1. MODUL BROWSE TRANSAKSI UTAMA (ufrmBrowseSJ)
// ==========================================

// Get List Master Surat Jalan (Query: ?startDate=...&endDate=...&zcus=...&zdivisi=...)
router.get("/", verifyToken, sjController.browseSJ);

// Get Detail Surat Jalan berdasarkan Nomor SJ (Query: ?nomor=SJ-001)
router.get("/detail", verifyToken, sjController.getDetailSJByNomor);

// Cek Urutan Pengajuan Edit Terakhir
router.get(
  "/pengajuan/urut/:nomor",
  verifyToken,
  sjController.getUrutPengajuan,
);

// Submit Form Pengajuan Edit Perubahan Data
router.post("/pengajuan", verifyToken, sjController.submitPengajuan);

// Hapus Surat Jalan
router.delete("/:nomor", verifyToken, sjController.deleteSJ);

// ==========================================
// 2. MODUL APPROVAL SURAT JALAN (ufrmApproveSJ)
// ==========================================

// Lookup Data Master Approval (Query: ?startDate=...&endDate=...&cab=...&zcus=...&pendingOnly=...)
router.get(
  "/approval/lookup",
  verifyToken,
  sjController.browseMasterApprovalSj,
);

// Lookup Data Detail Approval
router.get(
  "/approval/lookup/details",
  verifyToken,
  sjController.getDetailApprovalSj,
);

// ==========================================
// 3. ACTION TOMBOL APPROVAL / PENDING / BATAL
// ==========================================

// Approve Surat Jalan
router.post("/approve", verifyToken, sjController.approveSj);
router.post("/approve/:nomor", verifyToken, sjController.approveSj);

// Pending Surat Jalan (Batal Approve)
router.post("/pending", verifyToken, sjController.pendingSj);
router.post("/pending/:nomor", verifyToken, sjController.pendingSj);

// Batal Surat Jalan
router.post("/batal", verifyToken, sjController.batalSj);
router.post("/batal/:nomor", verifyToken, sjController.batalSj);

module.exports = router;
