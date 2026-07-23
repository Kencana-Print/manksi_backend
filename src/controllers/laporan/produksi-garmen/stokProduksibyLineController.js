const svc = require("../../../services/laporan/produksi-garmen/stokProduksibyLineService");

const getBrowse = async (req, res) => {
  try {
    const { lini = "FINISHING", cab = "P04" } = req.query;
    const data = await svc.getBrowse(lini, cab);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
