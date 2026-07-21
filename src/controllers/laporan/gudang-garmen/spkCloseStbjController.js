const svc = require("../../../services/laporan/gudang-garmen/spkCloseStbjService");

const getBrowse = async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    if (bulan === undefined || !tahun) {
      return res
        .status(400)
        .json({ success: false, message: "Bulan dan Tahun wajib diisi." });
    }
    const data = await svc.getBrowse(Number(bulan), Number(tahun));
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
    const { bulan, tahun } = req.query;
    if (bulan === undefined || !tahun) {
      return res
        .status(400)
        .json({ success: false, message: "Bulan dan Tahun wajib diisi." });
    }
    const data = await svc.getAllDetail(Number(bulan), Number(tahun));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
