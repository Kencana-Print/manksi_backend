const svc = require("../../../services/laporan/produksi-garmen/monitoringProofService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, cab = "P04" } = req.query;
    if (!startDate) {
      return res
        .status(400)
        .json({ success: false, message: "MAP dari Tanggal wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
