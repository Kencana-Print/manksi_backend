const barangService = require("../../services/master/barangGarmenService");
const fs = require("fs");
const path = require("path");

const getBrowse = async (req, res) => {
  try {
    const divisiId = req.user.divisi; // Ambil dari token JWT
    const data = await barangService.getBrowse(divisiId);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await barangService.getById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });

    // Cek ketersediaan file gambar (opsional, agar frontend tahu ada gambarnya)
    const imagePath = path.join(
      __dirname,
      "../../../../public/images/barang",
      `${data.Kode}.jpg`,
    );
    data.HasImage = fs.existsSync(imagePath);

    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    // Jika menggunakan Multer, data form text ada di req.body
    await barangService.create(req.body, req.user.kode);
    res
      .status(201)
      .json({
        success: true,
        message: "Barang berhasil disimpan",
        kode: req.body.Kode,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    await barangService.update(req.params.kode, req.body, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Barang berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Endpoint terpisah khusus untuk upload gambar desain
const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Tidak ada file yang diunggah" });
    }
    // Asumsi: Multer sudah dikonfigurasi untuk menyimpan sebagai [Kode].jpg
    res
      .status(200)
      .json({ success: true, message: "Gambar berhasil diunggah" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getById, create, update, uploadImage };
