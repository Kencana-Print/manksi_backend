// backend/src/controllers/pabrik.controller.js
const pabrikService = require('../../../services/mmt/daftar/lookupPabrikService.js');

exports.getLookup = async (req, res) => {
    try {
        const data = await pabrikService.getLookupPabrik();
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};