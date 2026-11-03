const { verifyToken } = require("../../../../middleware/authMiddleware");
// backend/routes/poPaperprint.routes.js

const express = require("express");
const router = express.Router();
router.use(verifyToken);
const multer = require("multer");
const upload = multer({ limits: { fileSize: 1 * 1024 * 1024 } });
const controller = require("../../../../controllers/mmt/transaksi-khusus/spk-order/poPaperprintController.js");

// 1. Browse Master List (GET /api/po-paper)
router.get("/", controller.getPoPaperprint);

// 2. Generate Nomor PO Otomatis (GET /api/po-paper/max-nomor?tanggal=YYYY-MM-DD)
router.get("/max-nomor", controller.getMaxNomor);

// 3. Get Detail Item per Nomor PO (GET /api/po-paper/detail?nomor=PP.202608.0001)
router.get("/detail", controller.getPoPaperprintDetail);

// 4. Get Single PO (Header + Details) untuk Form Edit/Print (GET /api/po-paper/PP.202608.0001)
router.get("/:nomor", controller.getPoPaperprintByNomor);

// 5. Simpan PO Baru (POST /api/po-paper)
router.post("/", upload.any(), controller.createPoPaperprint);
router.put("/:nomor", upload.any(), controller.updatePoPaperprint);

// 7. Hapus PO (DELETE /api/po-paper/PP.202608.0001)
router.delete("/:nomor", controller.deletePoPaperprint);

module.exports = router;
