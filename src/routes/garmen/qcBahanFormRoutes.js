const express = require("express");
const router = express.Router();
const qcBahanFormController = require("../../controllers/garmen/qcBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware");

const MENU_ID = 186;

// Pilih PO + baris bahan (modal)
router.get(
  "/lookup-po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  qcBahanFormController.lookupPo,
);

// Prefill dari baris PO: ?po=PC/00019/2026&nourut=1
router.get(
  "/po-source",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  qcBahanFormController.getPoSource,
);

// Detail untuk mode ubah: ?nomor=QCB/00001/2026
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  qcBahanFormController.getDetail,
);

// Simpan (mode baru maupun ubah)
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  qcBahanFormController.saveData,
);

router.get(
  "/lampiran/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  qcBahanFormController.getLampiran,
);
router.post(
  "/lampiran/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  upload.single("file"),
  qcBahanFormController.saveLampiran,
);
router.delete(
  "/lampiran/:nomor/:jenis",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  qcBahanFormController.deleteLampiran,
);

module.exports = router;
