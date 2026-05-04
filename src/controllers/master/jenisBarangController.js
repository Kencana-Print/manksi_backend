const jenisBarangService = require("../../services/master/jenisBarangService");

const getBrowse = async (req, res) => {
  try {
    const data = await jenisBarangService.getBrowse();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await jenisBarangService.getById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    if (!req.body.Kode || !req.body.Nama) {
      return res
        .status(400)
        .json({ success: false, message: "Kode dan Nama wajib diisi" });
    }
    await jenisBarangService.create(req.body);
    res
      .status(201)
      .json({ success: true, message: "Jenis Barang berhasil disimpan" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    if (!req.body.Nama) {
      return res
        .status(400)
        .json({ success: false, message: "Nama wajib diisi" });
    }
    await jenisBarangService.update(req.params.kode, req.body);
    res
      .status(200)
      .json({ success: true, message: "Jenis Barang berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getById, create, update };
