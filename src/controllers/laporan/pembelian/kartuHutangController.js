const svc = require("../../../services/laporan/pembelian/kartuHutangService");

const getMaster = async (req, res) => {
  try {
    const { startDate, endDate, supplier, hanyaSisa } = req.query;
    const data = await svc.getMaster({
      startDate,
      endDate,
      supplier,
      hanyaSisa: hanyaSisa === "1" || hanyaSisa === "true",
    });
    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
};

const getNota = async (req, res) => {
  try {
    const { startDate, endDate, supKode } = req.query;
    const data = await svc.getNota({ startDate, endDate, supKode });
    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
};

const getVoucher = async (req, res) => {
  try {
    const { startDate, endDate, nomor } = req.query;
    const data = await svc.getVoucher({ startDate, endDate, nomor });
    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
};

module.exports = { getMaster, getNota, getVoucher };
