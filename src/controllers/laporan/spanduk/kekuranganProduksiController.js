const service = require("../../../services/laporan/spanduk/kekuranganProduksiService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, perusahaan } = req.query;
    const data = await service.getKekuranganProduksi(
      { tglAwal, tglAkhir, perusahaan },
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse };
