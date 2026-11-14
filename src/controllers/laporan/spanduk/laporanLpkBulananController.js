const service = require("../../../services/laporan/spanduk/laporanLpkBulananService");

const getData = async (req, res) => {
  try {
    const data = await service.getData({
      tglAwal: req.query.tglAwal,
      tglAkhir: req.query.tglAkhir,
      grain: req.query.grain,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error getData LPK Bulanan:", error);
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message });
  }
};

module.exports = { getData };
