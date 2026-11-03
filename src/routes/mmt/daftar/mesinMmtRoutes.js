const express = require("express");
const router = express.Router();
const mesinController = require("../../../controllers/mmt/daftar/mesinMmtController");
const { verifyToken } = require("../../../middleware/authMiddleware");

router.use(verifyToken);

// 1. Browse / List Utama
// Menangani pencarian global atau list mesin
router.get("/", mesinController.getLookupMesin);

// 2. Endpoint Lookup Spesifik
// Menangani request untuk bantuan (F1)
router.get("/lookup/list", mesinController.getLookupMesin);

// 3. Action Endpoints
// Simpan (Menggunakan middleware verifyToken untuk mencatat user)
router.post("/save", mesinController.saveMesin);

// 4. Endpoint dengan Parameter Dinamis (Paling Bawah)
// Get detail (loaddata)
router.get("/:kode", mesinController.getMesinDetail);

// Delete (hapusdata - F5)
router.delete("/:kode", mesinController.deleteMesin);

module.exports = router;