const svc = require("../../../services/laporan/finance/stokFinanceService");

const getCabangList = async (req, res) => {
  try {
    const data = await svc.getCabangList();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMaster = async (req, res) => {
  try {
    const { cabang } = req.query;
    if (!cabang) {
      return res
        .status(400)
        .json({ success: false, message: "Cabang wajib diisi." });
    }
    const data = await svc.getMaster(cabang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { cabang } = req.query;
    if (!cabang) {
      return res
        .status(400)
        .json({ success: false, message: "Cabang wajib diisi." });
    }
    const data = await svc.getDetail(cabang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getCabangList, getMaster, getDetail };
