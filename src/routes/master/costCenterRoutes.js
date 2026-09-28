const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/costCenterController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.get("/", verifyToken, controller.getAll);
router.get("/:kode", verifyToken, controller.getById);
router.post("/", verifyToken, controller.saveData);
router.delete("/:kode", verifyToken, controller.deleteData);

module.exports = router;
