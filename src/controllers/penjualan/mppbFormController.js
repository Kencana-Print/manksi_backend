const mppbFormService = require("../../services/penjualan/mppbFormService");
const upload = require("../../middleware/uploadMiddleware");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const getDetail = async (req, res) => {
  try {
    const data = await mppbFormService.getDetailForm(req.params.nomor);
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

const uploadGambar = [
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "Tidak ada file yang diunggah." });
      }

      const { nomor, tipe } = req.body;
      if (!nomor) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res
          .status(400)
          .json({ success: false, message: "Nomor MPPB tidak valid." });
      }

      const finalName =
        tipe === "dokumen" ? `${nomor}-doc.jpg` : `${nomor}.jpg`;
      const uploadDir = path.join(process.cwd(), "public", "images", "mppb");
      if (!fs.existsSync(uploadDir))
        fs.mkdirSync(uploadDir, { recursive: true });
      const finalPath = path.join(uploadDir, finalName);

      // Konversi & kompres pakai sharp (sama seperti mintaHargaFormController)
      await sharp(req.file.path)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toFormat("jpeg")
        .jpeg({ quality: 90 })
        .toFile(finalPath);

      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

      const imageUrl = `/images/mppb/${finalName}`;
      res.status(200).json({
        success: true,
        message: "Gambar berhasil diupload.",
        imageUrl,
      });
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {}
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
];

const getMintaHargaDetail = async (req, res) => {
  try {
    const data = await mppbFormService.getMintaHargaDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getDetail, saveData, uploadGambar, getMintaHargaDetail };
