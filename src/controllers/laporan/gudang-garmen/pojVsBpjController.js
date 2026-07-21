const svc = require("../../../services/laporan/gudang-garmen/pojVsBpjService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, gudang = "", spk = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode Tanggal PO wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, gudang, spk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.getDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const { startDate, endDate, gudang = "", spk = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode Tanggal PO wajib diisi." });
    }
    const data = await svc.getAllDetail(startDate, endDate, gudang, spk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
