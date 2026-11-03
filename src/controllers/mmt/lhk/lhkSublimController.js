const sublimService = require('../../../services/mmt/lhk/lhkSublimService');

const browseSublim = async (req, res) => {
    try {
        const { startDate, endDate, keyword } = req.query;
        const data = await sublimService.getAllHeaders(startDate, endDate, keyword);
        
        // PERBAIKAN: Dibungkus objek { data } demi standardisasi stand-alone / lookup data table di Vue
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetailSublim = async (req, res) => {
    try {
        const nomor = req.params.nomor || req.query.nomor;
        
        if (!nomor) {
            return res.status(400).json({ message: "Parameter nomor tidak ditemukan" });
        }

        const data = await sublimService.getDetailsByNomor(nomor);
        const header = await sublimService.getHeaderByNomor(nomor);
        
        res.status(200).json({ header, data, details: data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveSublim = async (req, res) => {
    try {
        const result = await sublimService.saveLhk(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteSublim = async (req, res) => {
    try {
        const result = await sublimService.deleteLhk(req.params.nomor);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    browseSublim,
    getDetailSublim,
    saveSublim,
    deleteSublim
};