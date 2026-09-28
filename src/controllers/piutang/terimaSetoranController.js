const svc = require("../../services/piutang/terimaSetoranService");

const getCabang = async (req, res) => {
  try {
    const data = await svc.getCabang();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    const data = await svc.getBrowse(startDate, endDate, cabang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    const data = await svc.getBrowseDetail(startDate, endDate, cabang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowsePendingAll = async (req, res) => {
  try {
    const data = await svc.getBrowsePendingAll();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getCabang, getBrowse, getBrowseDetail, getBrowsePendingAll };
