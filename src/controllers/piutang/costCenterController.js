const costCenterService = require("../../services/piutang/costCenterService");

const search = async (req, res) => {
  try {
    const data = await costCenterService.search(req.query.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { search };
