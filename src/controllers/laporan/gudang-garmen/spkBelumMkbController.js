const service = require("../../../services/laporan/gudang-garmen/spkBelumMkbService");

const getSpkBelumMkb = async (req, res) => {
  try {
    const data = await service.getSpkBelumMkb(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getSpkBelumMkb,
};
