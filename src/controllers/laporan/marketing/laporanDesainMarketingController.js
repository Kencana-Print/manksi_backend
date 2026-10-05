const service = require("../../../services/laporan/marketing/laporanDesainMarketingService");

const getReport = async (req, res) => {
  try {
    const data = await service.getReport(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSummary = async (req, res) => {
  try {
    const data = await service.getSummaryByDesainer(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getReport, getSummary };
