const service = require('../../../../services/mmt/bahan-baku-produksi/barcode/createBarcodeService');

exports.getNextNumber = async (req, res) => {
    try {
        const { kodeBahan, tanggal } = req.query;
        const result = await service.getLastSequence(kodeBahan, tanggal);
        res.status(200).json({ success: true, nextSeq: result.nextSeq, ym: result.ym });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.saveBatch = async (req, res) => {
    try {
        const user = req.user?.username || req.user?.kode || req.user?.nama || 'SYSTEM';
        const result = await service.saveBatchBarcode(req.body.items, user);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.generate = async (req, res) => {
    try {
        const user = req.user?.username || req.user?.kode || req.user?.nama || 'SYSTEM';
        const result = await service.createManualBarcode(req.body, user);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getHistory = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const result = await service.getHistory({ startDate, endDate });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};