const svc = require("../../../services/laporan/gudang-garmen/mutasiStokBahanService");

const parseBool = (v) => v === "true" || v === true || v === "1";

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, gudang = "", tampilkanKosong } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getBrowse(
      startDate,
      endDate,
      gudang,
      parseBool(tampilkanKosong),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
    const { startDate, endDate, gudang = "", tampilkanKosong } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getAllDetail(
      startDate,
      endDate,
      gudang,
      parseBool(tampilkanKosong),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
