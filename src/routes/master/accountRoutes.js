const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/accountController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.get("/kelompok", verifyToken, controller.getKelompok);
router.get("/cabang", verifyToken, controller.getCabang);
router.get("/", verifyToken, controller.getAll);
router.get("/:kode", verifyToken, controller.getById);
router.post("/", verifyToken, controller.saveData);
router.delete("/:kode", verifyToken, controller.deleteData);

module.exports = router;
