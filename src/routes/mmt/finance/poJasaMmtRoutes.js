// backend/src/routes/mmt/finance/poJasaMmtRoutes.js
const express = require("express");
const router = express.Router();
const { verifyToken } = require("../../../middleware/authMiddleware");
const poCtrl = require("../../../controllers/mmt/finance/poJasaMmtController");

router.use(verifyToken);

// === ENDPOINT STATIS / SPESIFIK ===
router.get("/", poCtrl.browse);
router.post("/save", poCtrl.save);
router.post("/submit-pin", poCtrl.submitPin);
router.get("/lookup-bpb", poCtrl.getLookupBpb);
router.get("/date-close", poCtrl.getDateClose);
router.get("/date-close/:modul", poCtrl.getDateClose);
router.get("/print/:nomor", poCtrl.printData);
router.get("/detail/:nomor", poCtrl.getDetailForBpb);
router.get("/sudah-terima/:nomor", poCtrl.getSudahTerima);
router.get("/check-pin/:nomor", poCtrl.checkPin);
router.get("/sync-spk/:nomor", poCtrl.syncSpk);

// === ENDPOINT DINAMIS UMUM ===
router.get("/:nomor", poCtrl.getById);
router.delete("/:nomor", poCtrl.remove);

module.exports = router;
