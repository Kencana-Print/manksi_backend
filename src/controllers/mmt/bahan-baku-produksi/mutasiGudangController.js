const mutasiService = require('../../../services/mmt/bahan-baku-produksi/mutasiGudangService'); // Sesuaikan path file service Anda

exports.createMutasi = async (req, res) => {
    try {
        const result = await mutasiService.saveMutasiGudang(req.body, false, (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM'));
        res.status(201).json({
            success: true,
            message: "Data mutasi berhasil disimpan",
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateMutasi = async (req, res) => {
    try {
        const { nomor } = req.params;
        // Memastikan Nomor di body sama dengan nomor di URL params
        const data = { ...req.body, Nomor: nomor };
        
        const result = await mutasiService.saveMutasiGudang(data, true, (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM'));
        res.status(200).json({
            success: true,
            message: `Data mutasi ${nomor} berhasil diperbarui`,
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getMutasiDetail = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await mutasiService.getMutasiGudangDetail(nomor);
        if (!data) {
            return res.status(404).json({ success: false, message: `Data mutasi ${nomor} tidak ditemukan.` });
        }
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteMutasi = async (req, res) => {
    try {
        const { nomor } = req.params;
        await mutasiService.deleteMutasiGudang(nomor);
        res.status(200).json({ success: true, message: `Data mutasi ${nomor} berhasil dihapus.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllMutasi = async (req, res) => {    try {
        const { startDate, endDate, search } = req.query;
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        const start = startDate || defaultStart.toISOString().slice(0, 10);
        const end = endDate || new Date().toISOString().slice(0, 10);

        const data = await mutasiService.getMutasiData(start, end, search || '');
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.generateNomor = async (req, res) => {
    try {
        const nomor = await mutasiService.getNewNomorMutasi();
        res.status(200).json({ success: true, nomor });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};