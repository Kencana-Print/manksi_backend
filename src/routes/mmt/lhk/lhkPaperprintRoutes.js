const { verifyToken } = require("../../../middleware/authMiddleware");
const express = require("express");
const router = express.Router();
router.use(verifyToken);
const lhkSublimController = require("../../../controllers/mmt/lhk/lhkPaperprintController");

// =========================================================
// ROUTE STATIS (Harus diletakkan di atas rute dinamis /:nomor)
// =========================================================

// Mengambil list header (Browse) berdasarkan range tanggal
router.get("/", lhkSublimController.getLhkList);

// Mengambil nomor urut otomatis berikutnya
router.get("/next-number", lhkSublimController.getNextNumber);

// 🌟 ROUTE BARU: Endpoint untuk mengambil data lookup paperprint
router.get("/lookup/paperprint", lhkSublimController.getLookupPaperprint);

// List History Approval (Browse)
router.get("/approval-history", lhkSublimController.getApprovalList);

// Detail History Approval (Expand Row)
router.get(
  "/approval-history/detail/:nomor",
  lhkSublimController.getApprovalDetails,
);

// =========================================================
// ROUTE DINAMIS (Mengandung parameter /:nomor)
// =========================================================

// Mengambil rincian detail saja berdasarkan nomor (untuk Expand row di tabel)
router.get("/detail/:nomor", lhkSublimController.getLhkDetails);

// Mengambil full data (Header + Detail) untuk mode EDIT
router.get("/:nomor", lhkSublimController.getLhkFullData);

// Simpan data (Handle Create baru & Update data lama)
router.post("/", lhkSublimController.handleSaveLhk);

// ACC data
router.post("/acc/:nomor", lhkSublimController.accLhk);

// Hapus data (Header & Detail)
router.delete("/:nomor", lhkSublimController.removeLhk);

module.exports = router;
