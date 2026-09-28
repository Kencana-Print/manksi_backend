const express = require("express");
const router = express.Router();
const jenisPembayaranController = require("../../controllers/master/jenisPembayaranController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.use(verifyToken);

router.get("/", jenisPembayaranController.getAll);
router.post("/", jenisPembayaranController.saveData);
router.delete("/:nama", jenisPembayaranController.deleteData);

module.exports = router;
