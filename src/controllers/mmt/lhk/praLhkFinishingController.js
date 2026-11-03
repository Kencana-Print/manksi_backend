const service = require('../../../services/mmt/lhk/lhkFinishingService');

const saveDraft = async (req, res) => {
    try {
        const { details } = req.body;

        /**
         * 1. Cek (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') (hasil decode JWT dari middleware auth)
         * 2. Jika middleware tidak ada/gagal, ambil dari payload frontend
         * 3. Terakhir gunakan 'SYSTEM'
         */
        const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || details[0]?.input_by || 'SYSTEM';

        // Panggil service
        const result = await service.savePraLhk(details, userLogin);
        res.json(result);
    } catch (error) {
        console.error("Controller Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUnassigned = async (req, res) => {
    try {
        // Pastikan 'proses' didefinisikan di sini
        const { tanggal, shift, proses } = req.query; 
        
        // Kirimkan 'proses' ke service
        const data = await service.getUnassignedPraLhk(tanggal, shift, proses);
        
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteDraft = async (req, res) => {
    try {
        const { id } = req.params;
        await service.deletePraLhk(id);
        res.json({ success: true, message: "Draft berhasil dihapus" });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

module.exports = {
    saveDraft,
    getUnassigned,
    deleteDraft
};