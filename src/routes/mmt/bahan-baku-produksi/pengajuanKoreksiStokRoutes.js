const express = require("express");
const verifyToken = require("../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require("../../../controllers/mmt/bahan-baku-produksi/pengajuanKoreksiStokController");

router.get("/", verifyToken, controller.getPengajuan);
router.get("/detail", verifyToken, controller.getDetail);
router.post("/", verifyToken, controller.savePengajuan);
router.delete("/:nomor", verifyToken, controller.deletePengajuan);
router.post("/:nomor/approve", verifyToken, controller.approvePengajuan);
router.post("/:nomor/reject", verifyToken, controller.rejectPengajuan);

module.exports = router;
