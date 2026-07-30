// controllers/laporan/gudang-garmen/stokBarangJadiController.js
const svc = require("../../../services/laporan/gudang-garmen/stokBarangJadiService");

const getBrowse = async (req, res) => {
  try {
    const { gudang = "" } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBrowse(gudang, canLihatCus);
    res.json({ success: true, data, canLihatCus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { gudang = "" } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getExportData(gudang, canLihatCus);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getExportData };
