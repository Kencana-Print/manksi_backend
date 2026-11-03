const obatService = require('../../../services/mmt/daftar/masterObatService.js');

/**
 * Mendapatkan semua data obat untuk tabel browse
 */
exports.getAllObat = async (req, res) => {
    try {
        // Simulasi privileges (bisa diambil dari session/token user nantinya)
        const privileges = {
            zLihatSup: 1, 
            zLihatBeli: 1
        };

        const data = await obatService.getBrowseObat(privileges);
        res.json({
            success: true,
            message: "Data obat berhasil dimuat",
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Mendapatkan data untuk lookup modal (MasterBahanModal)
 */
exports.getLookup = async (req, res) => {
    try {
        const keyword = req.query.q || "";
        const data = await obatService.getLookupObat(keyword);
        
        res.json({
            success: true,
            message: "Lookup obat berhasil dimuat",
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Menghapus data obat
 */
exports.removeObat = async (req, res) => {
    try {
        const { kode } = req.params;
        const result = await obatService.deleteObat(kode);

        if (result) {
            res.json({ success: true, message: "Data obat berhasil dihapus" });
        } else {
            res.status(404).json({ success: false, message: "Data tidak ditemukan" });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};