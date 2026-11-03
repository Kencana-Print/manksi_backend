// backend/src/controllers/laporanKirim.controller.js
const laporanKirimService = require('../../../services/mmt/laporan/lapKirimanService');

const getLaporanKiriman = async (req, res) => {
  try {
    const { startDate, endDate, gudang } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }

    const data = await laporanKirimService.getLaporanKirimanBySPK(
      startDate,
      endDate,
      gudang,
    );

    return res.status(200).json({
      success: true,
      message: "Berhasil mengambil data laporan kiriman per SPK",
      totalData: data.length,
      data: data,
    });
  } catch (error) {
    console.error("Error in getLaporanKiriman Controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Terjadi kesalahan pada server.",
    });
  }
};

module.exports = {
  getLaporanKiriman,
};
