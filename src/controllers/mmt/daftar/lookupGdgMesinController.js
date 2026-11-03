// src/controllers/mmt/daftar/lookupGdgMesinController.js
const lookupService = require("../../../services/mmt/daftar/lookupGdgMesinService");

const getGudangLookup = async (req, res) => {
    try {
        const { mode, divisi } = req.query;
        const data = await lookupService.getGudangLookup(mode, divisi);
        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error("Error in getGudangLookup:", error);
        res.status(500).json({ success: false, message: "Gagal memuat data gudang.", error: error.message });
    }
};

const getGudangDetail = async (req, res) => {
    const { kode } = req.params;
    try {
        const data = await lookupService.getGudangDetail(kode);
        if (!data) {
            return res.status(404).json({ success: false, message: "Kode gudang tidak ditemukan." });
        }
        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error("Error in getGudangDetail:", error);
        res.status(500).json({ success: false, message: "Gagal memuat detail gudang.", error: error.message });
    }
};

const getMesinCetakLookup = async (req, res) => {
    try {
        const data = await lookupService.getMesinCetakLookup();
        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error("Error in getMesinCetakLookup:", error);
        res.status(500).json({ success: false, message: "Gagal memuat data mesin.", error: error.message });
    }
};

module.exports = {
    getGudangLookup,
    getGudangDetail,
    getMesinCetakLookup
};

