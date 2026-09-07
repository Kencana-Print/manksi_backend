const express = require("express");
const router = express.Router();
const controller = require("../../controllers/piutang/pengajuanDanaFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 177;

router.get("/nik-search", verifyToken, controller.searchNik);
router.get("/nik-info/:nik", verifyToken, controller.getNikInfo);

// ⬅ Route statis/spesifik HARUS di atas "/:nomor" — kalau tidak,
// Express akan mencocokkan string ini sebagai nomor dan salah nyasar
// ke getFormDetail.
router.get("/permintaan-search", verifyToken, controller.searchPermintaanPjh);
router.get(
  "/permintaan-dtl/:pmtNomor",
  verifyToken,
  controller.getPermintaanDtl,
);
router.get("/jobbutuh-search", verifyToken, controller.searchJobButuh);
router.get("/jobbutuh-dtl/:jbNomor", verifyToken, controller.getJobButuhDtl);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getFormDetail,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.create,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.update,
);

module.exports = router;
