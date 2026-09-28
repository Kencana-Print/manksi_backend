const kelompokService = require("../../services/master/kelompokService");

const getAll = async (req, res) => {
  try {
    const data = await kelompokService.getAll();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await kelompokService.getById(req.params.kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const saveData = async (req, res) => {
  try {
    const isEdit = !!req.params.kode;
    const payload = {
      ...req.body,
      isEdit,
      kode: isEdit ? req.params.kode : req.body.kode,
    };
    const result = await kelompokService.saveData(payload);
    res.json({
      success: true,
      message: isEdit ? "Data berhasil diupdate." : "Data berhasil disimpan.",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await kelompokService.deleteData(req.params.kode);
    res.json({ success: true, message: "Data berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getAll, getById, saveData, deleteData };
