// backend/src/controllers/stokOpname.controller.js

const opnameService = require('../../../services/mmt/bahan-baku-produksi/stokOpnameGudangService');

exports.startSession = async (req, res) => {
    try {
        const { gdgKode, user } = req.body;

        if (!gdgKode || !user) {
            return res.status(400).json({ success: false, message: "Gudang dan User harus diisi" });
        }

        const result = await opnameService.startOpnameSession(gdgKode, user);
        res.status(201).json({
            success: true,
            message: `Sesi Opname ${result.sessionID} berhasil dimulai`,
            sessionID: result.sessionID
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.scanBarcode = async (req, res) => {
    try {
        const { barcode, sessionID } = req.query;

        if (!barcode || !sessionID) {
            return res.status(400).json({ success: false, message: "Barcode dan SessionID diperlukan" });
        }

        const data = await opnameService.scanBarcodeOpname(barcode, sessionID);
        
        if (!data) {
            return res.status(404).json({ 
                success: false, 
                message: "Barcode tidak ditemukan dalam daftar sesi opname ini" 
            });
        }

        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateScan = async (req, res) => {
    try {
        const { sessionID, barcode } = req.body; // Pastikan mengambil sessionID dan barcode
        const success = await opnameService.updateScanResult(sessionID, barcode);
        
        if (success) {
            res.json({ success: true, message: 'Barcode terverifikasi' });
        } else {
            res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getPending = async (req, res) => {
    try {
        const { sessionID } = req.params;
        const data = await opnameService.getAllSessionData(sessionID);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getReport = async (req, res) => {
    try {
        const { sessionID } = req.params;
        const reportData = await opnameService.getOpnameReport(sessionID);
        
        if (!reportData.details.length) {
            return res.status(404).json({ message: "Data laporan tidak ditemukan." });
        }

        res.json({
            success: true,
            data: reportData
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};