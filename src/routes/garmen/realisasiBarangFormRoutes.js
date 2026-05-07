const express = require("express");
const router = express.Router();
const formController = require("../../controllers/garmen/realisasiBarangFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "62";

router.use(verifyToken);

// Mengambil referensi Permintaan untuk form Create
router.get(
  "/referensi-permintaan/:nomorMinta",
  checkPermission(MENU_ID, "insert"),
  formController.getPermintaanDetail,
);

// Mengambil detail realisasi untuk form Edit
router.get(
  "/:nomor",
  checkPermission(MENU_ID, "view"),
  formController.getDetail,
);

router.get(
  "/print/:nomor",
  checkPermission(MENU_ID, "view"),
  formController.getPrint,
);

// Simpan Data (Create & Update)
router.post("/", checkPermission(MENU_ID, "insert"), formController.saveData);
router.put("/", checkPermission(MENU_ID, "edit"), formController.saveData);

module.exports = router;
