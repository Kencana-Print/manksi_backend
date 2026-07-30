const svc = require("../../../services/laporan/marketing/proyeksiBulananService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, laporan = 1 } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode tanggal wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, laporan);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { startDate, endDate, laporan = 1 } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode tanggal wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, laporan);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getExportData };
