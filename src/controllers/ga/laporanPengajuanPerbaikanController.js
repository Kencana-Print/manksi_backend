const service = require("../../services/ga/laporanPengajuanPerbaikanService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cabang, search } = req.query;
    if (!tglAwal || !tglAkhir) {
      return res.status(400).json({
        success: false,
        message: "Parameter tglAwal dan tglAkhir wajib diisi.",
      });
    }

    const data = await service.getBrowse({ tglAwal, tglAkhir, cabang, search });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetailByNomor = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetailByNomor(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cabang, search } = req.query;
    if (!tglAwal || !tglAkhir) {
      return res.status(400).json({
        success: false,
        message: "Parameter tglAwal dan tglAkhir wajib diisi.",
      });
    }

    const data = await service.getAllDetail({ tglAwal, tglAkhir, cabang, search });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getDetailByNomor,
  getAllDetail,
};
