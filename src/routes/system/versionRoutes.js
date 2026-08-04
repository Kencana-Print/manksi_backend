const express = require("express");
const router = express.Router();
const controller = require("../../controllers/system/versionController");

// Publik — tidak butuh verifyToken. Polling ini kadang berjalan
// bahkan sebelum user login (mis. di halaman login), dan tidak
// mengandung data sensitif.
router.get("/", controller.getVersion);

module.exports = router;
