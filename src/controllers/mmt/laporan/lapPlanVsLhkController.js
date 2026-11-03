// backend/src/controllers/lapPlanVsLhk.controller.js

const laporanService = require('../../../services/mmt/laporan/lapPlanVsLhkService');

exports.getPlanVsLhk = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Tanggal boleh kosong: service men-skip klausa tanggal (tanpa zero-date).
        const reportData = await laporanService.getPlanVsLhkReport(startDate, endDate);

        return res.status(200).json({
            success: true,
            message: "Berhasil mengambil laporan komparasi produksi.",
            data: reportData
        });
        
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
};

