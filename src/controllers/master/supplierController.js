const supplierService = require("../../services/master/supplierService");

const getBrowse = async (req, res) => {
  try {
    const data = await supplierService.getBrowse();
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await supplierService.getById(req.params.kode);
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
    const kode = await supplierService.create(req.body, req.user.kode);
    res
      .status(201)
      .json({ success: true, message: "Supplier berhasil disimpan", kode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    await supplierService.update(req.params.kode, req.body, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Supplier berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getById, create, update };
