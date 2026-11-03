const laporanService = require('../../../services/mmt/laporan/lapLsTintaService');

exports.getLaporan = async (req, res) => {
    try {
        const { startDate, endDate, gudang } = req.query;

        // Tanggal boleh kosong: service men-skip klausa tanggal (tanpa zero-date).
        const data = await laporanService.getLaporanStokObat(startDate, endDate, gudang);

        res.json({
            success: true,
            message: "Laporan stok tinta berhasil dimuat",
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};