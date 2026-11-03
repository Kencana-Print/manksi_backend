const service = require('../../../services/mmt/lhk/lhkFinishingService');

const getAllHeaders = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const rows = await service.getAllHeaders(startDate, endDate);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const searchSpk = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim() === '') {
            return res.status(400).json({ success: false, message: 'Keyword pencarian tidak boleh kosong.' });
        }
        const data = await service.searchSpkProgress(q.trim());
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// const getDetails = async (req, res) => {
//     try {
//         const { nomor } = req.query;
//         const rows = await service.getDetailsByNomor(nomor);
//         res.json({ success: true, data: rows });
//     } catch (error) {
//         res.status(500).json({ success: false, message: error.message });
//     }
// };

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.query; // atau req.params sesuai route
        if (!nomor) {
            return res.status(400).json({ success: false, message: "Nomor LHK diperlukan" });
        }

        const data = await service.getLhkFinishingByNomor(nomor);
        
        res.json({
            success: true,
            data: data // Ini sekarang berisi { Nomor, Tanggal, ..., Detail: [...] }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const processFinalize = async (req, res) => {
    try {
        const { headerData, details } = req.body; 

        // 1. Ambil user dari token (Sama seperti pola STBJ Anda)
        const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || req.user?.username || 'ADMIN';

        if (!details || !Array.isArray(details)) {
            return res.status(400).json({ 
                success: false, 
                message: "Data rincian (details) tidak ditemukan atau bukan array." 
            });
        }

        // 2. PERBAIKAN: Tambahkan userLogin sebagai argumen ke-3
        const result = await service.finalizeBundling(headerData, details, userLogin);
        
        res.json(result);
    } catch (error) {
        console.error("Error in processFinalize:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteHeader = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await service.deleteLhk(nomor);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getPendingPotong = async (req, res) => {
    try {
        const { targetProses } = req.query; // Misal: SEAMING, MATA_AYAM
        if (!targetProses) {
            return res.status(400).json({ success: false, message: "Parameter targetProses diperlukan." });
        }
        const rows = await service.getPendingPotong(targetProses);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const handleAcc = async (req, res) => {
    try {
        const { nomor, details } = req.body;
        const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM'); // Ambil dari token JWT auth

        const result = await service.approveAcc(nomor, details, userLogin);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateLhk = async (req, res) => {
    try {
        // Ambil nomor dan details dari body
        const { nomor, details } = req.body;
        const userLogin = req.user.username || 'ADMIN';

        // Validasi simpel
        if (!nomor) {
            return res.status(400).json({ success: false, message: "Nomor LHK tidak ditemukan dalam request" });
        }

        const result = await service.updateLhk(nomor, details, userLogin);
        res.json(result);
    } catch (error) {
        console.error("Controller Update Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    getAllHeaders,
    searchSpk,
    getDetails,
    processFinalize,
    deleteHeader,
    getPendingPotong,
    handleAcc,
    updateLhk
};