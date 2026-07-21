const svc = require("../../../services/laporan/gudang-garmen/browseMapService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode wajib diisi." });
    }
    const data = await svc.getBrowse(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Cetak BAST — cek status dulu, tolak kalau belum "Sudah" ──
const getBastPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const status = await svc.checkBeritaAcaraStatus(nomor);
    if (status !== "Sudah") {
      return res.status(400).json({
        success: false,
        message: "Nomor ini belum dibuatkan berita acara.",
      });
    }
    const data = await svc.getBastData(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getBastPrintData };
