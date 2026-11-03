const laporanBsService = require('../../../services/mmt/laporan/lapMonBsService');

/**
 * Mendapatkan Laporan BS dengan ringkasan kalkulasi
 */
const getLaporanBS = async (req, res) => {
    try {
        const { startDate, endDate, gdgKode, search, type } = req.query;

        // Validasi parameter tanggal wajib
        if (!startDate || !endDate) {
            return res.status(400).json({ 
                success: false, 
                message: "Filter rentang tanggal (startDate & endDate) wajib ditentukan." 
            });
        }

        const result = await laporanBsService.getLaporanBsData({
            startDate,
            endDate,
            gdgKode: gdgKode || null,
            search: search || null,
            type: type || 'ALL'
        });

        return res.status(200).json({
            success: true,
            message: "Berhasil memuat laporan BS.",
            summary: result.summary,
            data: result.list
        });

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
};

module.exports = {
    getLaporanBS
};
