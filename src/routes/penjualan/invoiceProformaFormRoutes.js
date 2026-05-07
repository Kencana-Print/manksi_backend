const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/invoiceProformaFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "157"; // Menu Invoice Proforma

router.use(verifyToken);

// Mendapatkan detail uang muka (untuk Form saat ganti nomor)
router.get(
  "/uang-muka/:nomor",
  checkPermission(MENU_ID, "view"),
  controller.getUangMuka,
);

// Mendapatkan seluruh detail form (Mode Edit)
router.get("/:nomor", checkPermission(MENU_ID, "view"), controller.getDetail);

// Simpan Data (Create & Update)
router.post("/", checkPermission(MENU_ID, "insert"), controller.saveData);
router.put("/", checkPermission(MENU_ID, "edit"), controller.saveData);

module.exports = router;
