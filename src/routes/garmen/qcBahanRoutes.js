const express = require("express");
const router = express.Router();
const qcBahanController = require("../../controllers/garmen/qcBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 186; // Browse QC Bahan

// Browse Header
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  qcBahanController.browseData,
);

// Browse Detail (expand baris)
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  qcBahanController.getBrowseDetail,
);

// Delete Data (hanya status DRAFT, dicek di service)
router.delete(
  "/delete/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  qcBahanController.deleteData,
);

// Pengajuan Perubahan Data (PIN)
router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  qcBahanController.requestPin,
);

router.post(
  "/submit/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  qcBahanController.submitData,
);

module.exports = router;
