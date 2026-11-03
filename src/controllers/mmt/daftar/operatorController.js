// backend/src/controllers/operatorMmt.controller.js

const service = require('../../../services/mmt/daftar/operatorService');

// GET /browse
const getOperators = async (req, res) => {
    try {
        const data = await service.getOperators();
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /:kode (untuk Edit)
const getOperatorByKode = async (req, res) => {
    const { kode } = req.params;
    try {
        const data = await service.getOperatorByKode(kode);
        if (!data) {
            return res.status(404).json({ message: "Operator tidak ditemukan." });
        }
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST/PUT (Save)
const saveOperator = async (req, res) => {
    const { Kode, Nama, isEdit } = req.body;
    try {
        const result = await service.saveOperator({ Kode, Nama }, isEdit);
        res.status(200).json({ message: "Data Operator berhasil disimpan.", data: result });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// DELETE
const deleteOperator = async (req, res) => {
    const { kode } = req.params;
    try {
        await service.deleteOperator(kode);
        res.status(200).json({ message: "Data berhasil dihapus." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Ekspor semua fungsi
module.exports = {
    getOperators,
    getOperatorByKode,
    saveOperator,
    deleteOperator
};