const finishingService = require('../../../services/mmt/laporan/lapMonFinishingService');

const getMonitoringFinishing = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Parameter tanggal harus diisi." });
    }

    const data = await finishingService.lapMonFinishing(startDate, endDate);
    
    res.status(200).json(data);
  } catch (error) {
    console.error("Error Finishing Report:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

module.exports = { getMonitoringFinishing };