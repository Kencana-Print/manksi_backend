const express = require("express");
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require("../../../../controllers/mmt/transaksi-khusus/spk-order/komitmenKirimController");

// Browse & detail
router.get("/browse", verifyToken, controller.getBrowse);
router.get("/detail/:nomor", verifyToken, controller.getDetail);
router.get("/form/:nomor", verifyToken, controller.getFormDetail);

// Master options
router.get("/cabang", verifyToken, controller.getCabang);
router.get("/divisi", verifyToken, controller.getDivisi);

// Header
router.post("/header", verifyToken, controller.createHeader);
router.put("/header/:nomor/field", verifyToken, controller.updateHeaderField);

// Close / delete header
router.put("/:nomor/close", verifyToken, controller.toggleClose);
router.delete("/:nomor", verifyToken, controller.deleteData);

// Pencapaian
router.get("/pencapaian/:nomor", verifyToken, controller.getPencapaian);
router.post("/pencapaian/:nomor", verifyToken, controller.savePencapaian);

// Notifikasi MAP
router.get("/unnotified-map", verifyToken, controller.getUnnotifiedMap);
router.post("/mark-notified", verifyToken, controller.markMapNotified);

// Search kandidat
router.get("/search/so", verifyToken, controller.searchKandidatSo);
router.get("/search/praorder", verifyToken, controller.searchKandidatPraOrder);
router.get("/search/map", verifyToken, controller.searchKandidatMap);

// Info
router.get("/info/so", verifyToken, controller.getSoInfo);
router.get("/info/map", verifyToken, controller.getMapInfo);
router.get("/info/mh", verifyToken, controller.getMhInfo);
router.get("/penawaran-detail", verifyToken, controller.getPenawaranDetailList);
router.get("/penawaran-item", verifyToken, controller.getPenawaranItemInfo);

// Detail rows
router.post("/:pjwNomor/detail", verifyToken, controller.addDetailRow);
router.put("/detail/:pjwdId/field", verifyToken, controller.updateDetailField);
router.delete("/detail/:pjwdId", verifyToken, controller.deleteDetailRow);
router.get("/check-period", verifyToken, controller.checkTargetPeriod);
router.post("/detail/:pjwdId/move", verifyToken, controller.moveDetailRow);

module.exports = router;
