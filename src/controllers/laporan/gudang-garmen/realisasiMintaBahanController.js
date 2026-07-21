const svc = require("../../../services/laporan/gudang-garmen/realisasiMintaBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cab = "ALL", spk = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl Permintaan wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, cab, spk);
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
    const { startDate, endDate, cab = "ALL", spk = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl Permintaan wajib diisi." });
    }
    const data = await svc.getAllDetail(startDate, endDate, cab, spk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
