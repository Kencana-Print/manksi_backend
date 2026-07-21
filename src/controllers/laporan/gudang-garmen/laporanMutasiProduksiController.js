const svc = require("../../../services/laporan/gudang-garmen/laporanMutasiProduksiService");

const getBrowse = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      cab = "ALL",
      nomorSpk = "",
      namaSpk = "",
    } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode Mutasi wajib diisi." });
    }
    const data = await svc.getBrowse({
      startDate,
      endDate,
      cab,
      nomorSpk,
      namaSpk,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse };
