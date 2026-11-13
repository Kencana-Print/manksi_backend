const laporanPersediaanService = require("../../../services/laporan/spanduk/laporanPersediaanService");

const getData = async (req, res) => {
  try {
    const { tanggal, sembunyiNol } = req.query;
    const data = await laporanPersediaanService.getData({
      tanggal,
      sembunyiNol: sembunyiNol === "1" || sembunyiNol === "true",
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error laporan persediaan spanduk:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getData };
