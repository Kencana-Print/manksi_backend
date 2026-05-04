const approveReturBahanService = require("../../services/garmen/approveReturBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Parameter startDate dan endDate wajib diisi.",
        });
    }

    const data = await approveReturBahanService.getBrowseData(
      startDate,
      endDate,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const batalApprove = async (req, res) => {
  try {
    const { noApprov } = req.params;
    await approveReturBahanService.batalApprove(noApprov);
    res.status(200).json({ success: true, message: "Berhasil dibatalkan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  batalApprove,
};
