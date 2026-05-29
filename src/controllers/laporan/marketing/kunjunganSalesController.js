const service = require("../../../services/laporan/marketing/kunjunganSalesService");

const getBrowse = async (req, res) => {
  try {
    const result = await service.getBrowse(req.query);
    res.status(200).json({
      success: true,
      data: result.data,
      summary: result.summary,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
};
