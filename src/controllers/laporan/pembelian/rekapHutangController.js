const svc = require("../../../services/laporan/pembelian/rekapHutangService");

const getRekapHutang = async (req, res) => {
  try {
    const { endDate } = req.query;
    const data = await svc.getRekapHutang({ endDate });
    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
};

const getDetailHutang = async (req, res) => {
  try {
    const { supKode, endDate } = req.query;
    const data = await svc.getDetailHutang({ supKode, endDate });
    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
};

const getDetailSemuaHutang = async (req, res) => {
  try {
    const { endDate } = req.query;
    const data = await svc.getDetailSemuaHutang({ endDate });
    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
};

module.exports = { getRekapHutang, getDetailHutang, getDetailSemuaHutang };
