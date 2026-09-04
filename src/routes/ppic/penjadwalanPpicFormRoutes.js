// routes/ppic/penjadwalanPpicFormRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/ppic/penjadwalanPpicFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 176;

router.get("/cabang", verifyToken, controller.getCabang);
router.get("/divisi", verifyToken, controller.getDivisi);
router.get(
  "/kandidat-pra-order",
  verifyToken,
  controller.searchPraOrderKandidat,
);
router.get("/kandidat-map", verifyToken, controller.searchMapKandidat);
router.get("/kandidat-so", verifyToken, controller.searchSoKandidat);
router.get("/so-info/:soNomor", verifyToken, controller.getSoInfo);
router.get("/map-info/:mapNomor", verifyToken, controller.getMapInfo);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getFormDetail,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.save,
);
router.post("/create", verifyToken, controller.createHeader);
router.patch("/:nomor/header", verifyToken, controller.updateHeaderField);
router.post("/row", verifyToken, controller.addDetailRow);
router.patch("/row/:pjwdId", verifyToken, controller.updateDetailField);
router.delete("/row/:pjwdId", verifyToken, controller.deleteDetailRow);
router.get(
  "/row/:pjwdId/check-target",
  verifyToken,
  controller.checkTargetPeriod,
);
router.post("/row/:pjwdId/move", verifyToken, controller.moveDetailRow);

module.exports = router;
