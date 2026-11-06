const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/spanduk/lhk/lhkDesignFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const lihat = [verifyToken, checkPermission(4, "view")];
const ubah = [verifyToken, checkPermission(4, "edit")];

// Rute statis dulu, sebelum rute dinamis /:nomor
router.get("/lookup/spk", ...lihat, controller.lookupSpk);
router.get("/lookup/designer", ...lihat, controller.lookupDesigner);
router.get("/lookup/mesin", ...lihat, controller.lookupMesin);
router.get("/lookup/bahan", ...lihat, controller.lookupBahan);

// Sesi timer
router.get("/sesi/aktif", ...lihat, controller.sesiAktif);
router.post("/sesi/mulai", ...ubah, controller.mulaiSesi);
router.get("/sesi/:id", ...lihat, controller.getSesi);
router.post("/sesi/:id/pause", ...ubah, controller.pauseSesi);
router.post("/sesi/:id/resume", ...ubah, controller.resumeSesi);
router.post("/sesi/:id/selesai", ...ubah, controller.selesaiSesi);
router.post("/sesi/:id/batal", ...ubah, controller.batalSesi);

// Simpan beberapa tab sekaligus (statis, sebelum PUT /:nomor)
router.put("/simpan", ...ubah, controller.simpanBatch);

router.get("/:nomor", ...lihat, controller.getById);
router.put("/:nomor", ...ubah, controller.simpan);

module.exports = router;
