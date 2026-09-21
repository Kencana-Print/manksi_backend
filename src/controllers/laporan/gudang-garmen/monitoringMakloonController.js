const svc = require("../../../services/laporan/gudang-garmen/monitoringMakloonService");

const getBrowse = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      cabAsal,
      cabTujuan,
      itemAwal,
      itemJadi,
      status,
      userInput,
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }

    const data = await svc.getBrowse({
      startDate,
      endDate,
      cabAsal,
      cabTujuan,
      itemAwal,
      itemJadi,
      status,
      userInput,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getCabangOptions = async (req, res) => {
  try {
    const data = await svc.getCabangOptions();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getCabangOptions };
