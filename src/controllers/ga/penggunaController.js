const service = require("../../services/ga/penggunaService");

const getMaxKode = async (req, res) => {
  try {
    const kode = await service.getMaxKode();
    res.json({ success: true, data: { kode } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

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
    const { kode } = req.params;
    const data = await service.getById(kode);
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
      message: `Pengguna ${result.nama} (${result.kode}) berhasil disimpan.`,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const { kode } = req.params;
    const result = await service.update(kode, req.body);
    res.json({
      success: true,
      message: `Pengguna ${result.nama} (${result.kode}) berhasil diperbarui.`,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { kode } = req.params;
    await service.deleteData(kode);
    res.json({
      success: true,
      message: `Pengguna dengan kode ${kode} berhasil dihapus.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getMaxKode,
  getAll,
  getById,
  create,
  update,
  deleteData,
};
