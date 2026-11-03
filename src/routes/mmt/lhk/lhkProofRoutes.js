const { verifyToken } = require("../../../middleware/authMiddleware");
const express = require("express");
const router = express.Router();
router.use(verifyToken);
const lhkController = require("../../../controllers/mmt/lhk/lhkProofController");

// Path: /api/mmt/lhk-proof

// Endpoint untuk mendapatkan list data (Browse)
router.get("/", lhkController.getBrowse);

// Endpoint untuk mendapatkan detail item (untuk expand row di tabel)
router.get("/detail/:nomor", lhkController.getDetailItems);

// Endpoint untuk mengambil satu data utuh (Header + Details) untuk mode Edit
router.get("/:nomor", lhkController.getOne);

// Endpoint untuk simpan data (POST untuk baru, PUT untuk update)
// Dalam lhkProof.service.js kita menggunakan logika saveLhk yang handle keduanya
router.post("/", lhkController.save);
router.post("/acc/:nomor", lhkController.accLhk);
router.put("/:nomor", lhkController.save);

// Endpoint untuk hapus data
router.delete("/:nomor", lhkController.delete);

module.exports = router;
