const bastService = require("../../services/garmen/bastService");

const getBrowseList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      onProgressOnly: req.query.onProgress,
    };
    const userCabang = req.user?.cabang || "ALL";
    const data = await bastService.getBrowseList(filters, userCabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteBast = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    await bastService.deleteBast(req.params.nomor, userKode);
    res.status(200).json({ success: true, message: "BAST berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      onProgressOnly: req.query.onProgress,
    };
    const userCabang = req.user?.cabang || "ALL";
    const data = await bastService.getExportDetail(filters, userCabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  deleteBast,
  getExportDetail,
};
