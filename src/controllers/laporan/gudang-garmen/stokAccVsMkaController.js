const svc = require("../../../services/laporan/gudang-garmen/stokAccVsMkaService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode Tgl MKA wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { kode } = req.params;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode Tgl MKA wajib diisi." });
    }
    const data = await svc.getDetail(kode, startDate, endDate);
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
        .json({ success: false, message: "Periode Tgl MKA wajib diisi." });
    }
    const data = await svc.getAllDetail(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
