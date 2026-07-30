const service = require("../../../services/laporan/penjualan/spkVsSjService");

const getBrowse = async (req, res) => {
  try {
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await service.getBrowseList(req.query, canLihatCus);
    res.json({ success: true, data, canLihatCus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetailByNomor(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
};
