const searchService = require('../../../../services/mmt/bahan-baku-produksi/barcode/searchBarcodeService');

/**
 * Controller untuk pencarian barcode cepat (Quick Search)
 * Tanpa perlu session ID, langsung menembak ke Master Stok.
 */
exports.quickCheck = async (req, res) => {
    try {
        const { barcode } = req.query;

        // 1. Validasi Input
        if (!barcode) {
            return res.status(400).json({ 
                success: false, 
                message: "Barcode tidak boleh kosong!" 
            });
        }

        // 2. Panggil Service untuk cari di Master Stok
        const data = await searchService.findBarcodeDetail(barcode);
        
        // 3. Cek apakah data ditemukan
        if (!data) {
            return res.status(404).json({ 
                success: false, 
                message: `Barcode ${barcode} tidak terdaftar atau stok sudah kosong.` 
            });
        }

        // 4. Kirim Respon Sukses
        res.status(200).json({ 
            success: true, 
            message: "Data ditemukan",
            data: data 
        });

    } catch (error) {
        console.error("Error pada quickCheck:", error.message);
        res.status(500).json({ 
            success: false, 
            message: "Terjadi kesalahan internal server.",
            error: error.message 
        });
    }
};

/**
 * Controller riwayat pergerakan satu barcode (kartu stok per roll).
 */
exports.getHistory = async (req, res) => {
    try {
        const { barcode } = req.query;
        if (!barcode || !String(barcode).trim()) {
            return res.status(400).json({
                success: false,
                message: "Barcode tidak boleh kosong!"
            });
        }
        const data = await searchService.getBarcodeHistory(barcode);
        if (!data) {
            return res.status(404).json({
                success: false,
                message: `Barcode ${barcode} tidak memiliki riwayat pergerakan.`
            });
        }
        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error("Error pada getHistory:", error.message);
        res.status(500).json({
            success: false,
            message: "Terjadi kesalahan internal server.",
            error: error.message
        });
    }
};

exports.getInventoryList = async (req, res) => {    try {
        // 1. Ambil brg_kode DAN gdg_kode dari query string (?brg_kode=xxx&gdg_kode=yyy)
        const { brg_kode, gdg_kode } = req.query; 
        
        // 2. Masukkan ke dalam object filters agar diterima oleh service
        const data = await searchService.getAllInventory({ 
            brg_kode: brg_kode, 
            gdg_kode: gdg_kode 
        });

        // 3. Kirim respon ke frontend
        res.status(200).json({
            success: true,
            count: data.length,
            data: data
        });
    } catch (error) {
        console.error("Error di getInventoryList:", error.message);
        res.status(500).json({ 
            success: false, 
            message: "Gagal memuat daftar inventaris: " + error.message 
        });
    }
};