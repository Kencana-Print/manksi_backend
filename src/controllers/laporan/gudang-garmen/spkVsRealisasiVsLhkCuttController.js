const svc = require("../../../services/laporan/gudang-garmen/spkVsRealisasiVsLhkCuttService");

const parseIsMap = (val) => val === "true" || val === "1" || val === true;

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, spk = "", map = "false" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl SPK wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, spk, parseIsMap(map));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { spk } = req.params;
    const data = await svc.getDetail(spk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const { startDate, endDate, spk = "", map = "false" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl SPK wajib diisi." });
    }
    const data = await svc.getAllDetail(
      startDate,
      endDate,
      spk,
      parseIsMap(map),
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
