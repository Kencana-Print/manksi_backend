// backend/src/controllers/returProduksi.controller.js

const returService = require('../../../services/mmt/bahan-baku-produksi/returProduksiService');
const { format } = require('date-fns');

exports.scanBarcode = async (req, res) => {
    try {
        const { barcode, gudangAsal } = req.query;
        if (!barcode || !gudangAsal) {
            return res.status(400).json({ message: 'Barcode dan Gudang Asal harus diisi' });
        }

        const data = await returService.getStokByBarcode(barcode, gudangAsal);
        if (!data) {
            return res.status(404).json({ message: 'Barang tidak ditemukan atau stok kosong di gudang tersebut' });
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getBrowseData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Default range: awal bulan ini sampai hari ini jika tidak diisi
        const start = startDate || format(new Date(), 'yyyy-MM-01');
        const end = endDate || format(new Date(), 'yyyy-MM-dd');

        const data = await returService.getReturProduksiData(start, end);
        
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getNewNomor = async (req, res) => {
    try {
        const nomor = await returService.getNewNomor();
        res.json({ nomor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getReturByNomor = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await returService.getReturProduksiByNomor(nomor);
        if (!data) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createRetur = async (req, res) => {
    try {
        // userLogin diambil dari middleware auth (jika ada)
        const userLogin = req.user ? (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') : 'SYSTEM';
        const result = await returService.saveReturProduksi(req.body, false, userLogin);
        
        res.status(201).json({
            success: true,
            message: 'Retur produksi berhasil disimpan',
            nomor: result.nomor
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateRetur = async (req, res) => {
    try {
        const { nomor } = req.params;
        const userLogin = (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || 'ADMIN';
        
        const data = { ...req.body, Nomor: nomor };
        const result = await returService.saveReturProduksi(data, true, userLogin);
        
        res.json({
            success: true,
            message: `Retur ${nomor} berhasil diperbarui`
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteRetur = async (req, res) => {
    try {
        const { nomor } = req.params;
        const success = await returService.deleteReturProduksi(nomor);
        
        if (success) {
            res.json({ message: 'Data retur berhasil dihapus' });
        } else {
            res.status(404).json({ message: 'Data tidak ditemukan' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};