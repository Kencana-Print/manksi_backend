const svc = require("../../../services/laporan/produksi-garmen/monitoringKekuranganProduksiJahitService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, cab = "P04" } = req.query;
    if (!startDate) {
      return res
        .status(400)
        .json({ success: false, message: "SPK dari Tanggal wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
