const svc = require("../../../services/laporan/produksi-garmen/standarBabaranProofService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cab = "P04" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Periode MAP dari Tanggal wajib diisi.",
        });
    }
    const data = await svc.getBrowse(startDate, endDate, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
