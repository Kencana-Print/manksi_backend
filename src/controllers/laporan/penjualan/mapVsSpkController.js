const service = require("../../../services/laporan/penjualan/mapVsSpkService");

const getMapVsSpk = async (req, res) => {
  try {
    const data = await service.getMapVsSpk(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMapVsSpk,
};
