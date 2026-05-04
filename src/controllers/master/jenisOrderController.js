const jenisOrderService = require("../../services/master/jenisOrderService");

const getBrowse = async (req, res) => {
  try {
    const data = await jenisOrderService.getBrowse();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await jenisOrderService.getById(req.params.kode);
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
    await jenisOrderService.create(req.body);
    res
      .status(201)
      .json({ success: true, message: "Jenis Order berhasil disimpan" });
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
    await jenisOrderService.update(req.params.kode, req.body);
    res
      .status(200)
      .json({ success: true, message: "Jenis Order berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getById, create, update };
