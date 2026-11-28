const svc = require("../../../services/laporan/pembelian/poOutstandingService");

const getPoOutstanding = async (req, res) => {
  try {
    const { startDate, endDate, jenis, supKode, search } = req.query;
    const data = await svc.getPoOutstanding(
      { startDate, endDate, jenis, supKode, search },
      req.user,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getPoOutstanding };
