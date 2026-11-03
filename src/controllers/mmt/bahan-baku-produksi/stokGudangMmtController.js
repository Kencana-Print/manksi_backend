const service = require('../../../services/mmt/bahan-baku-produksi/stokGudangMmtService.js');

exports.checkBarcodeStok = async (req, res) => {
    try {
        const { barcode } = req.params;

        if (!barcode) {
            return res.status(400).json({
                success: false,
                message: "Parameter barcode wajib diisi."
            });
        }

        const data = await service.getStokByBarcode(barcode);

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Barcode tidak ditemukan atau stok sudah habis (0 M)."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Data barcode ditemukan.",
            data: data
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data barcode.",
            error: error.message
        });
    }
};