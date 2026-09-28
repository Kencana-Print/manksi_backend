const svc = require("../../../services/laporan/finance/listJurnalService");

const getListJurnal = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await svc.getListJurnal(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getListJurnal };
