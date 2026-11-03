// src/controllers/poInternal.controller.js
const poInternalService = require('../../../../services/mmt/transaksi-khusus/spk-order/poInternalService.js');

/**
 * @desc Mendapatkan daftar PO Internal untuk Lookup (Modal)
 * @route GET /api/v1/mmt/poi/lookup
 */
const getPOInternalLookup = async (req, res) => {
    try {
        // Logika Delphi: Khusus Supplier P05 dan Bahan MMT LL-000400
        const data = await poInternalService.getPOInternalLookup();

        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error('Error in getPOInternalLookup:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal memuat data lookup PO Internal.', 
            error: error.message 
        });
    }
};




module.exports = {
    getPOInternalLookup,

};