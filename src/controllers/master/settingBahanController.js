const settingBahanService = require("../../services/master/settingBahanService");

const getBrowse = async (req, res) => {
  try {
    const data = await settingBahanService.getBrowse();
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await settingBahanService.getById(req.params.kode);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    }
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    await settingBahanService.create(req.body);
    res
      .status(201)
      .json({ success: true, message: "Setting bahan berhasil disimpan" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    await settingBahanService.update(req.params.kode, req.body);
    res
      .status(200)
      .json({ success: true, message: "Setting bahan berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await settingBahanService.remove(req.params.kode);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getById,
  create,
  update,
  remove,
};
