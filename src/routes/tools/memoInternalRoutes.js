const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/tools/memoInternalController");
const { verifyToken } = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware");

// Error multer (ukuran, tipe) dijawab 400 yang jelas, bukan 500
const unggahPdf = (req, res, next) => {
  upload.pdf.single("file")(req, res, (err) => {
    if (err) {
      const pesan =
        err.code === "LIMIT_FILE_SIZE"
          ? "Ukuran PDF maksimal 10 MB."
          : err.message;
      return res.status(400).json({ success: false, message: pesan });
    }
    next();
  });
};

router.get("/", verifyToken, ctrl.getList);
router.get("/unread", verifyToken, ctrl.getUnread);
router.get("/:id/file", verifyToken, ctrl.getFile);
router.post("/", verifyToken, ctrl.hanyaBagianUpload, unggahPdf, ctrl.simpan);
router.delete("/:id", verifyToken, ctrl.hanyaBagianUpload, ctrl.hapus);

module.exports = router;
