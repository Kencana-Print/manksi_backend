const service = require("../../services/ga/kendaraanService");

const getAll = async (req, res) => {
  try {
    const { search } = req.query;
    const data = await service.getAll(search);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nopol } = req.params;
    const data = await service.getById(nopol);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const create = async (req, res) => {
  try {
    const result = await service.create(req.body);
    res.status(201).json({
      success: true,
      message: `Kendaraan ${result.nopol} berhasil disimpan.`,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const { nopol } = req.params;
    const result = await service.update(nopol, req.body);
    res.json({
      success: true,
      message: `Kendaraan ${result.nopol} berhasil diperbarui.`,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nopol } = req.params;
    await service.deleteData(nopol);
    res.json({
      success: true,
      message: `Kendaraan ${nopol} berhasil dihapus.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteData,
};
