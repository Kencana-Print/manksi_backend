const komponenSpkService = require("../../services/master/komponenSpkService");

const getBrowse = async (req, res) => {
  try {
    const startDate =
      req.query.startDate || new Date().toISOString().split("T")[0];
    const endDate = req.query.endDate || new Date().toISOString().split("T")[0];

    const data = await komponenSpkService.getBrowse(startDate, endDate);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await komponenSpkService.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getDetail };
