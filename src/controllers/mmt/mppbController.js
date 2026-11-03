const mppbService = require("../../services/mmt/mppbService");

/**
 * Handler GET lookup daftar MPPB
 */
const getMPPBLookup = async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const startDate = req.query.start_date || req.query.startDate || thirtyDaysAgo;
    const endDate = req.query.end_date || req.query.endDate || today;

    const data = await mppbService.getMPPBLookup(startDate, endDate);

    res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Error in getMPPBLookup:", error);
    res.status(500).json({
      success: false,
      message: "Gagal memuat data lookup MPPB.",
      error: error.message,
    });
  }
};

/**
 * Handler GET detail MPPB by nomor
 */
const getMPPBByNomor = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mppbService.getMPPBByNomor(nomor);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `Data MPPB dengan nomor ${nomor} tidak ditemukan.`,
      });
    }

    // Kembalikan objek data dengan properti root agar kompatibel dengan sistem MMT asli dan Manksi
    res.status(200).json({
      success: true,
      data: data,
      ...data,
    });
  } catch (error) {
    console.error("Error in getMPPBByNomor:", error);
    res.status(500).json({
      success: false,
      message: "Gagal memuat detail data MPPB.",
      error: error.message,
    });
  }
};

module.exports = {
  getMPPBLookup,
  getMPPBByNomor,
};

