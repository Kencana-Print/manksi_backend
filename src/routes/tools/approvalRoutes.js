const express = require("express");
const router = express.Router();
const controller = require("../../controllers/tools/approvalController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// --- APPROVAL SPK PIUTANG > 90 HARI (MENU_ID: 256) ---
router.get(
  "/piutang",
  verifyToken,
  checkPermission(256, "view"),
  controller.getMasterData,
);
router.get(
  "/piutang/:cusKode/pengajuan",
  verifyToken,
  checkPermission(256, "view"),
  controller.getPengajuanDtl,
);
router.get(
  "/piutang/:cusKode/invoice/:status",
  verifyToken,
  checkPermission(256, "view"),
  controller.getInvoiceList,
);
router.post(
  "/piutang/otorisasi",
  verifyToken,
  checkPermission(256, "edit"),
  controller.submitOtorisasi,
);

// --- APPROVAL SPK HARGA 0 (MENU_ID: 257) ---
router.get(
  "/harga-nol",
  verifyToken,
  checkPermission(257, "view"),
  controller.getHargaNolList,
);
router.get(
  "/harga-nol/:nomor/info",
  verifyToken,
  checkPermission(257, "view"),
  controller.getHargaNolDetailInfo,
);
router.post(
  "/harga-nol/otorisasi",
  verifyToken,
  checkPermission(257, "edit"),
  controller.submitHargaNolOtorisasi,
);

// --- APPROVAL SPK KLIEN PRIORITAS (MENU_ID: 258) ---
router.get(
  "/prioritas",
  verifyToken,
  checkPermission(258, "view"),
  controller.getPrioritasList,
);
router.post(
  "/prioritas/otorisasi",
  verifyToken,
  checkPermission(258, "edit"),
  controller.submitPrioritasOtorisasi,
);

// --- APPROVAL INVOICE BELUM BUAT SJ (MENU_ID: 260) ---
router.get(
  "/invoice-blm-sj",
  verifyToken,
  checkPermission(260, "view"),
  controller.getInvoiceBlmSjList,
);
router.post(
  "/invoice-blm-sj/otorisasi",
  verifyToken,
  checkPermission(260, "edit"),
  controller.submitInvoiceBlmSjOtorisasi,
);

// --- APPROVAL PERUBAHAN DATA (MENU_ID: 259) ---
router.get(
  "/perubahan-data",
  verifyToken,
  checkPermission(259, "view"),
  controller.getPerubahanDataList,
);
router.post(
  "/perubahan-data/otorisasi",
  verifyToken,
  checkPermission(259, "edit"),
  controller.submitPerubahanDataOtorisasi,
);

// --- APPROVAL HAPUS DATA (MENU_ID: 261) ---
router.get(
  "/hapus-data",
  verifyToken,
  checkPermission(261, "view"),
  controller.getHapusDataList,
);
router.post(
  "/hapus-data/otorisasi",
  verifyToken,
  checkPermission(261, "edit"),
  controller.submitHapusDataOtorisasi,
);

// --- APPROVAL PLAFON CUSTOMER MANAGER (MENU_ID: 262) ---
router.get(
  "/plafon",
  verifyToken,
  checkPermission(263, "view"),
  controller.getPlafonList,
);
router.post(
  "/plafon/otorisasi",
  verifyToken,
  checkPermission(263, "edit"),
  controller.submitPlafonOtorisasi,
);

// --- APPROVAL PLAFON CUSTOMER DIREKSI (MENU_ID: 264) ---
// Pakai endpoint yang sama, perbedaan jenis ditentukan via query param ?jenis=PENDING_DIREKSI
// dan validasi hak akses ada di service (cek bagian DIREKSI/OWNER)
router.get(
  "/plafon-direksi",
  verifyToken,
  checkPermission(264, "view"),
  controller.getPlafonList,
);
router.post(
  "/plafon-direksi/otorisasi",
  verifyToken,
  checkPermission(264, "edit"),
  controller.submitPlafonOtorisasi,
);

// --- APPROVAL MUTASI PRODUKSI TANPA PLANNING PPIC (MENU_ID: 266) ---
router.get(
  "/mutasi-noplan",
  verifyToken,
  checkPermission(266, "view"),
  controller.getMutasiNoPlanList,
);
router.post(
  "/mutasi-noplan/otorisasi",
  verifyToken,
  checkPermission(266, "edit"),
  controller.submitMutasiNoPlanOtorisasi,
);

// --- APPROVAL SPK CETAK ULANG (MENU_ID: 267) ---
// routes
router.get(
  "/spk-cetak-ulang",
  verifyToken,
  checkPermission(267, "view"),
  controller.getSpkCetakUlangList,
);
router.post(
  "/spk-cetak-ulang/otorisasi",
  verifyToken,
  checkPermission(267, "edit"),
  controller.submitSpkCetakUlangOtorisasi,
);

// --- APPROVAL PEMBATALAN SPK/SO (MENU_ID: 262) ---
router.get(
  "/pembatalan-spk",
  verifyToken,
  checkPermission(262, "view"),
  controller.getPembatalanSpkList,
);
router.post(
  "/pembatalan-spk/otorisasi",
  verifyToken,
  checkPermission(262, "edit"),
  controller.submitPembatalanSpkOtorisasi,
);

// --- APPROVAL SPK GANTI QTY & JENIS KAIN (MENU_ID: 265) ---
router.get(
  "/ganti-qty-kain",
  verifyToken,
  checkPermission(265, "view"),
  controller.getGantiQtyKainList,
);
router.post(
  "/ganti-qty-kain/otorisasi",
  verifyToken,
  checkPermission(265, "edit"),
  controller.submitGantiQtyKainOtorisasi,
);

module.exports = router;
