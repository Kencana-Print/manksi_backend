const salesService = require("../../services/master/salesService");

const getBrowse = async (req, res) => {
  try {
    const data = await salesService.getBrowse();
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await salesService.getById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    if (!req.body.Nama) {
      return res
        .status(400)
        .json({ success: false, message: "Nama wajib diisi" });
    }
    const kode = await salesService.create(req.body, req.user.kode);
    res
      .status(201)
      .json({ success: true, message: "Sales berhasil disimpan", kode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    if (!req.body.Nama) {
      return res
        .status(400)
        .json({ success: false, message: "Nama wajib diisi" });
    }
    await salesService.update(req.params.kode, req.body, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Sales berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await salesService.remove(req.params.kode);
    res.status(200).json({ success: true, message: "Sales berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getById, create, update, remove };
