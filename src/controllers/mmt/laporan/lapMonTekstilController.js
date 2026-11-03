const tekstilService = require('../../../services/mmt/laporan/lapMonTekstilService');

const getMonitoringTekstil = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Validasi input tanggal
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: "Parameter startDate dan endDate wajib diisi (YYYY-MM-DD)." 
      });
    }

    // Panggil fungsi service
    const data = await tekstilService.lapMonTekstil(startDate, endDate);
    
    // Kirim response sukses
    res.status(200).json(data);
  } catch (error) {
    console.error("Error pada Monitoring Tekstil Controller:", error);
    res.status(500).json({ 
      message: "Terjadi kesalahan internal pada server.",
      error: error.message 
    });
  }
};

module.exports = { 
  getMonitoringTekstil 
};