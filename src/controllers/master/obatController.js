const obatService = require("../../services/master/obatService");

const getBrowse = async (req, res) => {
  try {
    const data = await obatService.getBrowse();
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await obatService.getById(req.params.kode);
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
    const kode = await obatService.create(req.body);
    res
      .status(201)
      .json({ success: true, message: "Obat berhasil disimpan", kode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    await obatService.update(req.params.kode, req.body);
    res
      .status(200)
      .json({ success: true, message: "Obat berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await obatService.getLookups(req.params.category);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getById, create, update, getLookups };
