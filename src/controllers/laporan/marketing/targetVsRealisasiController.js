const svc = require("../../../services/laporan/marketing/targetVsRealisasiService");

const getBrowse = async (req, res) => {
  try {
    const { tahun, bulan = "" } = req.query;
    if (!tahun) {
      return res
        .status(400)
        .json({ success: false, message: "Tahun wajib diisi." });
    }
    const data = await svc.getBrowse(tahun, bulan);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
