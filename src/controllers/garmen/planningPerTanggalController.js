const service = require("../../services/garmen/planningPerTanggalService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowseList(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDivisiOptions = async (req, res) => {
  res.json({ success: true, data: service.DIVISI_OPTIONS });
};

module.exports = {
  getBrowse,
  getDivisiOptions,
};
