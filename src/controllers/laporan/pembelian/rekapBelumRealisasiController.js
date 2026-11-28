const svc = require("../../../services/laporan/pembelian/rekapBelumRealisasiService");

const getRekapBelumRealisasi = async (req, res) => {
  try {
    const { startDate, endDate, tahap } = req.query;
    const data = await svc.getRekapBelumRealisasi({
      startDate,
      endDate,
      tahap,
    });
    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
};

module.exports = { getRekapBelumRealisasi };
