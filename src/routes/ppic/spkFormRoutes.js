const express = require("express");
const router = express.Router();
const controller = require("../../controllers/ppic/spkFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware");

const MENU_ID = 152; // ID Menu SPK PPIC

router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

router.get(
  "/so-source",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSoSource,
);

router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);
router.put(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.save,
);

router.get("/init-sizes", verifyToken, controller.getInitSizes);
router.get("/standar-ukuran", verifyToken, controller.getStandarUkuran);
router.get("/mkb-detail", verifyToken, controller.getMkbDetailBySpk);
router.get("/komponen-master", verifyToken, controller.getKomponenMaster);
router.get(
  "/mka-from-map/:mapNomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getMkaFromMap,
);

router.post(
  "/layout-proses/import",
  verifyToken,
  upload.single("file"),
  controller.importLayoutProses,
);
router.get("/layout-proses", verifyToken, controller.getLayoutProses);
router.get("/keterangan-khusus", verifyToken, controller.getKeteranganKhusus);
router.get(
  "/ket-komponen-master",
  verifyToken,
  controller.getKetKomponenMaster,
);

module.exports = router;
