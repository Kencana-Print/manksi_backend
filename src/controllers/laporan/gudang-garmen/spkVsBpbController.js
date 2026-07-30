const svc = require("../../../services/laporan/gudang-garmen/spkVsBpbService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tanggal wajib diisi." });
    }
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBrowse(startDate, endDate, canLihatCus);
    res.json({ success: true, data, canLihatCus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { spkNomor } = req.params;
    const data = await svc.getDetail(spkNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tanggal wajib diisi." });
    }
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getAllDetail(startDate, endDate, canLihatCus);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
