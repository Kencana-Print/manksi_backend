const svc = require("../../../services/laporan/finance/biayaPerDivisiService");

const getListDivisi = async (req, res) => {
  try {
    const data = await svc.getListDivisi();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBiayaPerDivisi = async (req, res) => {
  try {
    const { cckode, startDate, endDate } = req.query;
    if (!cckode || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Divisi dan periode wajib diisi.",
      });
    }
    const data = await svc.getBiayaPerDivisi(cckode, startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getListDivisi, getBiayaPerDivisi };
