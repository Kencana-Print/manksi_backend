// backend/controllers/lhkCetak.controller.js
const lhkCetakService = require('../../../services/mmt/lhk/lhkCetakMmtService');

const getAllHeaders = async (req, res) => {
    try {
        const { startDate, endDate, mesin } = req.query;
        // Jika filter tanggal tidak dikirim, service akan menangani default-nya
        const data = await lhkCetakService.getAllHeaders(startDate, endDate, mesin);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: "Gagal mengambil data master LHK", error: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        // req.params untuk mendapatkan :nomor dari URL
        const { nomor } = req.params; 
        
        // req.query untuk mendapatkan ?mesin=... dari URL
        const { mesin } = req.query; 

        if (!nomor) {
            return res.status(400).json({ message: "Nomor LHK diperlukan" });
        }
        
        // Teruskan 'mesin' sebagai argumen kedua ke fungsi service
        const data = await lhkCetakService.getDetailsByNomor(nomor, mesin);
        
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({ message: "Gagal mengambil detail LHK", error: error.message });
    }
};

const saveLhk = async (req, res) => {
    try {
        // 1. Tambahkan 'inkData' di sini agar diambil dari body request
        const { header, details, inkData, existingNomor } = req.body; 
        
        const nomorLhk = existingNomor || req.params.nomor; 

        if (!header || !details) {
            return res.status(400).json({ message: "Data Header dan Detail harus diisi" });
        }

        // 2. Kirim 'inkData' ke service sebagai parameter ke-3
        // Urutannya harus sesuai dengan definisi di Service: (header, details, inkData, nomorLhk)
        const result = await lhkCetakService.saveLhk(header, details, inkData, nomorLhk);
        
        res.status(200).json({
            data: { 
                success: true, 
                nomor: result.nomor 
            },
            message: nomorLhk ? "Data berhasil diperbarui" : "Data berhasil disimpan"
        });
    } catch (error) {
        console.error("Controller Save Error:", error);
        res.status(500).json({ message: "Gagal menyimpan data", error: error.message });
    }
};

const deleteLhk = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await lhkCetakService.deleteLhk(nomor);
        res.json({ message: "Data berhasil dihapus", result });
    } catch (error) {
        res.status(500).json({ message: "Gagal menghapus data", error: error.message });
    }
};

const getRekapLhk = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const data = await lhkCetakService.getRekapLhk(startDate, endDate);
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({ message: "Gagal mengambil rekap LHK", error: error.message });
    }
};



const getRekapCrossTab = async (req, res) => {
    try {
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: "Bulan dan Tahun diperlukan" });
        }

        // Memanggil service rekap harian yang menyertakan data per mesin
        const data = await lhkCetakService.getRekapLhkByMonth(month, year);
        
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({ message: "Gagal mengambil data cross-tab", error: error.message });
    }
};

const getDetailRekapMesin = async (req, res) => {
    try {
        const { startDate, endDate, mesin } = req.query;
        const data = await lhkCetakService.getDetailRekapMesin(startDate, endDate, mesin);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const exportLhk = async (req, res) => {
    try {
        const { startDate, endDate, mesin } = req.query;
        
        // Memanggil fungsi service yang melakukan JOIN Header & Detail
        const data = await lhkCetakService.getAllDataForExport(startDate, endDate, mesin);
        
        res.status(200).json({
            success: true,
            message: "Data export berhasil ditarik",
            data: data
        });
    } catch (error) {
        console.error("Error pada exportLhk Controller:", error);
        res.status(500).json({
            success: false,
            message: "Gagal menarik data untuk export",
            error: error.message
        });
    }
};


const getOneLhk = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await lhkCetakService.getOneLhk(nomor); 
        
        if (!data) {
            return res.status(404).json({ 
                success: false, 
                message: "Data rekap tidak ditemukan" 
            });
        }
        

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

module.exports = {
    getAllHeaders,
    getDetails,
    saveLhk,
    deleteLhk,
    getRekapLhk,
    getRekapCrossTab,
    getDetailRekapMesin,
    exportLhk,
    getOneLhk




};