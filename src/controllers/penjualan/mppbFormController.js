const mppbFormService = require("../../services/penjualan/mppbFormService");
const multer = require("multer");
const path = require("path");

// --- SETUP MULTER (Penyimpanan Gambar ke Folder Spesifik) ---
// Sesuai Delphi: apathimage + \nomor.jpg atau \nomor-doc.jpg
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Arahkan ke folder mount server (sesuaikan jika path linux beda)
    cb(null, process.env.IMAGE_UPLOAD_PATH || "/mnt/image");
  },
  filename: function (req, file, cb) {
    // Nama file ditentukan dari parameter URL (dikirim dari frontend saat proses upload)
    const { nomor, tipe } = req.body;
    let ext = path.extname(file.originalname).toLowerCase();
    if (![".jpg", ".jpeg", ".png"].includes(ext)) ext = ".jpg"; // fallback

    const finalName = tipe === "dokumen" ? `${nomor}-doc.jpg` : `${nomor}.jpg`;
    cb(null, finalName);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1000000 }, // Batas 1 MB sesuai Delphi
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Hanya file gambar yang diperbolehkan!"), false);
  },
}).single("image"); // Key input file dari Postman/Vue adalah "image"

// --- ENDPOINTS ---

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mppbFormService.getDetailForm(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await mppbFormService.saveData(req.body, req.user);
    res
      .status(200)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const uploadGambar = (req, res) => {
  upload(req, res, function (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ success: false, message: "Ukuran gambar tidak boleh > 1 MB." });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Tidak ada file yang diunggah." });
    }

    res
      .status(200)
      .json({ success: true, message: "Gambar berhasil diupload." });
  });
};

module.exports = {
  getDetail,
  saveData,
  uploadGambar,
};
