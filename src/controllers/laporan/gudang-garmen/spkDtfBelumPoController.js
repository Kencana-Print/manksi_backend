const svc = require("../../../services/laporan/gudang-garmen/spkDtfBelumPoService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cab = "P04", supplier = "" } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Tanggal SPK wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate, cab, supplier);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
