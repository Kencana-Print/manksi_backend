// src/controllers/report.controller.js
const sublimService = require('../../../services/mmt/laporan/lapMonSublimService');

const getSublimMonitoring = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Parameter startDate dan endDate wajib diisi.'
      });
    }

    const data = await sublimService.lapMonSublim(startDate, endDate);

    return res.status(200).json({
      success: true,
      message: 'Berhasil memuat data monitoring sublim.',
      data: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kegagalan server pada internal query.',
      error: error.message
    });
  }
};

module.exports = { getSublimMonitoring };