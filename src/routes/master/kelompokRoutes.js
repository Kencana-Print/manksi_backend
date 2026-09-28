const express = require("express");
const router = express.Router();
const kelompokController = require("../../controllers/master/kelompokController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.use(verifyToken);

router.get("/", kelompokController.getAll);
router.get("/:kode", kelompokController.getById);
router.post("/", kelompokController.saveData);
router.put("/:kode", kelompokController.saveData);
router.delete("/:kode", kelompokController.deleteData);

module.exports = router;
