const service = require("../../../services/laporan/penjualan/penawaranVsSpkService");

const getBrowse = async (req, res) => {
  try {
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await service.getBrowse(req.query, canLihatCus);
    res.status(200).json({ success: true, data, canLihatCus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const data = await service.getBrowseDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await service.getAllDetail(req.query, canLihatCus);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getAllDetail,
};
