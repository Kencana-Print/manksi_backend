const svc = require("../../services/garmen/lhkPolaService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const today = new Date().toISOString().substring(0, 10);
    const data = await svc.getBrowse({
      startDate: startDate || today,
      endDate: endDate || today,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
};
