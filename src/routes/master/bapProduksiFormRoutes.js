const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/bapProduksiFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID 142
const menuId = 142;

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getById,
);
router.get("/print/:nomor", verifyToken, controller.getPrintData);
router.get("/spk/:spkNomor", verifyToken, controller.getSpkDetail);

// Gunakan POST untuk create & update (diatur lewat isNewMode di body)
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.save,
);

module.exports = router;
