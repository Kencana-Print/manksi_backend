const voucherService = require('../../../services/mmt/finance/voucherPelunasanService.js');

exports.createVoucher = async (req, res) => {
    try {
        // userLogin diambil dari middleware auth (jika ada)
        const userLogin = req.user?.username || 'SYSTEM'; 
        const result = await voucherService.saveVoucher(req.body, userLogin);
        
        res.status(201).json({
            success: true,
            message: "Voucher pengajuan pelunasan berhasil dibuat",
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getVouchers = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        // Validasi simpel untuk tanggal
        if (!startDate || !endDate) {
            return res.status(400).json({ message: "Parameter startDate dan endDate diperlukan" });
        }
        
        const data = await voucherService.getVoucherData(startDate, endDate);
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getOutstandingInvoices = async (req, res) => {
    try {
        const { supKode } = req.params;
        const data = await voucherService.getOutstandingInvoices(supKode);
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};