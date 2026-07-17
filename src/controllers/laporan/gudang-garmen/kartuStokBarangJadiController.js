const svc = require("../../../services/laporan/gudang-garmen/kartuStokBarangJadiService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, kode, gudang = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    if (!kode) {
      return res
        .status(400)
        .json({ success: false, message: "Kode Barang harus diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, kode, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { kode } = req.params;
    const { startDate, endDate, gudang = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getDetail(kode, startDate, endDate, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const { startDate, endDate, kode, gudang = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    if (!kode) {
      return res
        .status(400)
        .json({ success: false, message: "Kode Barang harus diisi." });
    }
    const data = await svc.getAllDetail(startDate, endDate, kode, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
