const service = require("../../services/penjualan/lhkDesainService");

const getOutstanding = async (req, res) => {
  try {
    const data = await service.getOutstanding(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const data = await service.getHistory(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createBatch = async (req, res) => {
  try {
    const data = await service.createBatch(req.body.pdNomorList, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getOutstanding, getHistory, createBatch };
