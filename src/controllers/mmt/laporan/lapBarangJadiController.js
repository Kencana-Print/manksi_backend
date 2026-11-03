const mmtService = require('../../../services/mmt/laporan/lapBarangJadiService');

const getReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Tanggal boleh kosong (filter dikosongkan dari DateRangeFilter):
        // service men-skip klausa tanggal bila kosong, tanpa zero-date.
        const data = await mmtService.getLaporanBarangJadi(startDate, endDate);
        
        res.json({
            status: true,
            message: "Success",
            data: data
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

module.exports = {
    getReport
};