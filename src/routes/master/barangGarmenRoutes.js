const express = require("express");
const router = express.Router();
const controller = require("../../controllers/master/barangGarmenController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

const menuId = 19; // Master Barang Garmen

// Konfigurasi Multer untuk Upload Gambar Design Barang
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "../../../../public/images/barang");
    // Buat folder jika belum ada
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Simpan dengan nama [Kode].jpg berdasarkan parameter URL
    cb(null, req.params.kode + ".jpg");
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Hanya izinkan gambar
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file gambar yang diizinkan!"));
    }
  },
});

// Routes
router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getBrowse,
);
router.get(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getById,
);
router.post(
  "/",
  verifyToken,
  checkPermission(menuId, "insert"),
  controller.create,
);
router.put(
  "/:kode",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.update,
);

// Route khusus Upload Gambar
router.post(
  "/:kode/image",
  verifyToken,
  checkPermission(menuId, "edit"),
  upload.single("image"),
  controller.uploadImage,
);

module.exports = router;
