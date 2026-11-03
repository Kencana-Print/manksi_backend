const MmtService = require('../../../services/mmt/bahan-baku-produksi/mmtPinjamService');

const MmtController = {
    // Endpoint POST /mmt/request-pinjam
    handleRequestPinjam: async (req, res) => {
        try {
            const payload = req.body;

            // Validasi sederhana
            if (!payload.barcode || !payload.nomor_spk) {
                return res.status(400).json({
                    success: false,
                    message: "Barcode dan Nomor SPK wajib diisi."
                });
            }

            await MmtService.createPinjamRequest(payload);

            res.status(200).json({
                success: true,
                message: "Permintaan pinjam berhasil dikirim ke Gudang Utama."
            });
        } catch (error) {
            console.error('Controller Error (handleRequestPinjam):', error.message);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server: " + error.message
            });
        }
    },

    // Endpoint GET /mmt/pending-loans
    getPendingLoans: async (req, res) => {
        try {
            const data = await MmtService.getAllPendingLoans();
            res.status(200).json({
                success: true,
                data: data
            });
        } catch (error) {
            console.error('Controller Error (getPendingLoans):', error.message);
            res.status(500).json({
                success: false,
                message: "Gagal mengambil data notifikasi."
            });
        }
    },

    handleApprovePinjam: async (req, res) => {
        try {
            const { barcode, nomor_permintaan } = req.body;

            if (!barcode) {
                return res.status(400).json({
                    success: false,
                    message: "Barcode tidak ditemukan dalam request."
                });
            }

            await MmtService.approveLoan(barcode, nomor_permintaan);

            res.status(200).json({
                success: true,
                message: `Barcode ${barcode} berhasil di-approve dan dimutasi ke GPM.`
            });
        } catch (error) {
            console.error('Controller Error (handleApprovePinjam):', error.message);
            res.status(500).json({
                success: false,
                message: "Gagal memproses persetujuan: " + error.message
            });
        }
    }
};

module.exports = MmtController;