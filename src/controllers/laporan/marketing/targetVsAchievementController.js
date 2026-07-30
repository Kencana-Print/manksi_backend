const svc = require("../../../services/laporan/marketing/targetVsAchievementService");

const getBrowse = async (req, res) => {
  try {
    const { tahun, bulanAwal, bulanAkhir } = req.query;
    if (!tahun || !bulanAwal || !bulanAkhir) {
      return res.status(400).json({
        success: false,
        message: "Tahun, bulan awal, dan bulan akhir wajib diisi.",
      });
    }
    if (Number(bulanAkhir) < Number(bulanAwal)) {
      return res.status(400).json({
        success: false,
        message: "Periode awal tidak boleh lebih besar dari periode akhir.",
      });
    }
    const data = await svc.getBrowse(tahun, bulanAwal, bulanAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateProyeksi = async (req, res) => {
  try {
    const { tahun, bulan, pySales } = req.body;
    const data = await svc.updateProyeksi(tahun, bulan, pySales);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, updateProyeksi };
