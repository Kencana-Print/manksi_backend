const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/complainCustomerController");

router.get("/", controller.getBrowse);
router.delete("/:nomor", controller.deleteComplain);

module.exports = router;
