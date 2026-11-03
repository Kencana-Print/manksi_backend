// backend/src/controllers/stbj.controller.js

const stbjService = require('../../../../services/mmt/transaksi-khusus/pengiriman/stbjService');

exports.browseSTBJ = async (req, res) => {
    try {
        const { startDate, endDate, gdgKode } = req.query;
        // Default pencarian jika gdgKode kosong adalah '%' (semua)
        const data = await stbjService.getBrowseSTBJ(startDate, endDate, gdgKode || "");
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getDetail = async (req, res) => {
    try {
        // SEBELUMNYA: const { nomor } = req.params;
        // SESUDAH:
        const { nomor } = req.query; 

        if (!nomor) {
            return res.status(400).json({ message: "Parameter nomor diperlukan" });
        }

        const data = await stbjService.getDetailSTBJ(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.createSTBJ = async (req, res) => {
    try {
        // PERBAIKAN: Sesuaikan .kdUser atau .username sesuai isi token Anda
        // Berdasarkan skema login Anda sebelumnya, biasanya menggunakan kdUser
        const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || 'ADMIN'; 
        
        const result = await stbjService.saveSTBJ(req.body, false, userLogin);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateSTBJ = async (req, res) => {
    try {
        const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || 'ADMIN';
        
        const result = await stbjService.saveSTBJ(req.body, true, userLogin);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteSTBJ = async (req, res) => {
    try {
        const { nomor } = req.params;
        const { gdgKode } = req.query; // Kirimkan gdgKode untuk logika WH003
        const success = await stbjService.deleteSTBJ(nomor, gdgKode);
        
        if (success) {
            res.json({ message: `STBJ ${nomor} berhasil dihapus` });
        } else {
            res.status(404).json({ message: "Data tidak ditemukan" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getSTBJByNomor = async (req, res) => {
    try {
        const { nomor } = req.params;
        if (!nomor) {
            return res.status(400).json({ message: "Nomor STBJ harus diisi" });
        }

        const data = await stbjService.getSTBJByNomor(nomor);
        res.json(data);
    } catch (error) {
        // Jika error berasal dari "tidak ditemukan" yang kita buat di service
        if (error.message.includes('tidak ditemukan')) {
            return res.status(404).json({ message: error.message });
        }
        res.status(500).json({ message: error.message });
    }
};

exports.updateSTBJ = async (req, res) => {
    try {
        const { nomor } = req.params; // Ambil nomor dari URL
        const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || 'ADMIN';
        
        // Pastikan payload memiliki nomor yang benar sebelum dikirim ke service
        const payload = req.body;
        if (!payload.header) payload.header = {};
        payload.header.stbj_nomor = nomor;

        const result = await stbjService.saveSTBJ(payload, true, userLogin);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};