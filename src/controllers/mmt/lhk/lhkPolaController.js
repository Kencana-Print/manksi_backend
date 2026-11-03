// backend/src/controllers/lhkPola.controller.js
const lhkPolaService = require('../../../services/mmt/lhk/lhkPolaService');

/**
 * @desc Mendapatkan daftar LHK Pola untuk Lookup (Modal) ke LHK Desain
 * @route GET /api/v1/lhk-pola/lookup
 */
const getLHKPolaLookup = async (req, res) => {
    try {
        const data = await lhkPolaService.getLHKPolaLookup();

        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error('Error in getLHKPolaLookup:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal memuat data lookup LHK Pola.', 
            error: error.message 
        });
    }
};

const getAllHeaders = async (req, res) => {
  try {
    const { startDate, endDate, search } = req.query;
    const data = await lhkPolaService.getAllHeaders({ startDate, endDate, search });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error in getAllHeaders LHK Pola:", error);
    res.status(500).json({
      message: "Gagal memuat data master LHK Pola.",
      error: error.message,
    });
  }
};

module.exports = {
    getAllHeaders,
    getLHKPolaLookup,
};