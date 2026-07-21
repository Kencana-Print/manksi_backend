const svc = require("../../../services/laporan/gudang-garmen/stokDcService");

const parseBool = (v) => v === "true" || v === true || v === "1";

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, tampilkanKosong } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getBrowse(
      startDate,
      endDate,
      parseBool(tampilkanKosong),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { spk, kode, size } = req.params;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const decodedSize = decodeURIComponent(size);
    const data = await svc.getDetail(
      decodeURIComponent(spk),
      decodeURIComponent(kode),
      decodedSize === "-" ? "" : decodedSize,
      startDate,
      endDate,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const { startDate, endDate, tampilkanKosong } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getAllDetail(
      startDate,
      endDate,
      parseBool(tampilkanKosong),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
