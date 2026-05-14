const service = require("../../services/laporan/realisasiPenawaranService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowse(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDashboardSummary = async (req, res) => {
  try {
    const data = await service.getDashboardSummary();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDashboardSummary,
};
