const svc = require("../../../services/laporan/gudang-garmen/spkVsRealisasiVsLhkCuttService");

const parseIsMap = (val) => val === "true" || val === "1" || val === true;

const getBrowse = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      spk = "",
      map = "false",
      namaBahan = "",
    } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl SPK wajib diisi." });
    }
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBrowse(
      startDate,
      endDate,
      spk,
      parseIsMap(map),
      canLihatCus,
      namaBahan,
    );
    res.json({ success: true, data, canLihatCus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { spk } = req.params;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getDetail(spk, canLihatCus);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      spk = "",
      map = "false",
      namaBahan = "",
    } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tgl SPK wajib diisi." });
    }
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getAllDetail(
      startDate,
      endDate,
      spk,
      parseIsMap(map),
      canLihatCus,
      namaBahan,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, getAllDetail };
