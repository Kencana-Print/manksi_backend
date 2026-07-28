const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Pastikan folder temp ada
const tempDir = path.join(process.cwd(), "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const tempName = "temp-" + uniqueSuffix + path.extname(file.originalname);
    cb(null, tempName);
  },
});

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith("image/") ||
    file.mimetype === "application/pdf"
  ) {
    cb(null, true);
  } else {
    cb(
      new Error("File harus berupa gambar (JPG, PNG) atau dokumen PDF."),
      false,
    );
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 50,
  },
  fileFilter: fileFilter,
});

// ─────────────────────────────────────────────────────────
// ⚠️ BARU: instance multer TERPISAH khusus file Excel (dipakai
// import Layout Proses SPK PPIC). fileFilter/limits punya-nya
// sendiri, tidak numpang ke fileFilter gambar/PDF di atas —
// itulah sebabnya upload Excel selama ini selalu ditolak
// ("File harus berupa gambar...") walau file valid.
// ─────────────────────────────────────────────────────────
const excelFileFilter = (req, file, cb) => {
  const allowedMimes = [
    "application/vnd.ms-excel", // .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  ];
  const allowedExt = /\.(xlsx|xls)$/i;

  if (
    allowedMimes.includes(file.mimetype) &&
    allowedExt.test(file.originalname)
  ) {
    cb(null, true);
  } else {
    cb(new Error("File harus berupa Excel (.xlsx atau .xls)."), false);
  }
};

const uploadExcel = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, tempDir); // reuse folder temp yang sama
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const tempName =
        "temp-layout-" + uniqueSuffix + path.extname(file.originalname);
      cb(null, tempName);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB — file Excel layout bisa lebih besar dari foto
    files: 1,
  },
  fileFilter: excelFileFilter,
});

// Export tetap backward-compatible: semua route lain yang sudah
// `require("../../middleware/uploadMiddleware")` dan pakai
// `upload.single(...)` langsung TIDAK perlu diubah sama sekali —
// `upload` (fungsi multer) bisa ditempeli properti tambahan.
upload.excel = uploadExcel;

module.exports = upload;
