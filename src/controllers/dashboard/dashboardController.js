const service = require("../../services/dashboard/dashboardService");

const getSpkUrgent = async (req, res) => {
  try {
    const data = await service.getSpkUrgent(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPenawaranSummary = async (req, res) => {
  try {
    const data = await service.getPenawaranSummary(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPenawaranBelumSpk = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const data = await service.getPenawaranBelumSpk(req.user, limit, offset);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSpkSummary = async (req, res) => {
  try {
    const data = await service.getSpkSummary(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getSpkUrgent,
  getPenawaranSummary,
  getPenawaranBelumSpk,
  getSpkSummary,
};
