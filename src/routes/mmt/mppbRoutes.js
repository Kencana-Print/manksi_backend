const express = require("express");
const router = express.Router();
const controller = require("../../controllers/mmt/mppbController");
const penjualanController = require("../../controllers/penjualan/mppbController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.use(verifyToken);

// Route untuk Modal Lookup MPPB (Sistem MMT)
router.get("/lookup", controller.getMPPBLookup);
router.get("/:nomor", controller.getMPPBByNomor);

// Kompatibilitas operasi MPPB Penjualan jika diakses lewat prefix /api/mmt/mppb
router.get("/", penjualanController.getBrowseList);
router.delete("/:nomor", penjualanController.deleteData);
router.post("/pengajuan", penjualanController.requestPin5);
router.put("/:nomor/approve", penjualanController.toggleApprove);

module.exports = router;

