const service = require("../../services/master/costCenterService");

const getAll = async (req, res) => {
  try {
    const data = await service.getAll();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await service.getById(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const data = await service.saveData(req.body);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await service.deleteData(req.params.kode);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getAll, getById, saveData, deleteData };
