const express = require("express");
const router = express.Router();
const controller = require("../../controllers/pembelian/settingHargaBahanController");
const { verifyToken } = require("../../middleware/authMiddleware");

// Gunakan verifyToken middleware
router.use(verifyToken);

// --- GARMEN KAIN ---
router.get("/garmen", controller.getKainGarmen);
router.post("/garmen", controller.createKainGarmen);
router.put("/garmen", controller.updateKainGarmen);
router.put("/garmen/:id", controller.updateKainGarmen);
router.delete("/garmen", controller.deleteKainGarmen);

// --- GARMEN TAMBAHAN / CUSTOM ---
router.get("/garmen-tambahan", controller.getTambahanGarmen);
router.post("/garmen-tambahan", controller.createTambahanGarmen);
router.put("/garmen-tambahan/:ket", controller.updateTambahanGarmen);
router.delete("/garmen-tambahan/:ket", controller.deleteTambahanGarmen);

// --- SPANDUK ---
router.get("/spanduk", controller.getSpanduk);
router.post("/spanduk", controller.createSpanduk);
router.put("/spanduk/:id", controller.updateSpanduk);
router.delete("/spanduk/:id", controller.deleteSpanduk);

// --- MMT BAHAN ---
router.get("/mmt", controller.getMmt);
router.post("/mmt", controller.createMmt);
router.put("/mmt/:id", controller.updateMmt);
router.delete("/mmt/:id", controller.deleteMmt);

// --- MMT TAMBAHAN / TOPPING ---
router.get("/mmt-tambahan", controller.getMmtTambahan);
router.post("/mmt-tambahan", controller.createMmtTambahan);
router.put("/mmt-tambahan/:id", controller.updateMmtTambahan);
router.delete("/mmt-tambahan/:id", controller.deleteMmtTambahan);

module.exports = router;
