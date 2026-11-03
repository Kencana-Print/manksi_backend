const service = require('../../../../services/mmt/transaksi-khusus/spk-order/penerimaanPoExtMmtService');

exports.browse = async (req, res) => {
    try {
        const { startDate, endDate, cab } = req.query;
        const data = await service.getBrowseData(startDate, endDate, cab);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const userCab = req.user?.cab; // Gunakan optional chaining agar aman

        await service.deleteBPB(nomor, userCab);
        res.json({ success: true, message: "Data berhasil dihapus dan status PO diperbarui." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.save = async (req, res) => {
    try {
        // 🌟 PERBAIKAN: Deteksi isUpdate secara akurat dari param URL (PUT) maupun body payload
        const urlNomor = req.params.nomor;
        const bodyNomor = req.body.Nomor;
        
        const isUpdate = (urlNomor && urlNomor !== 'AUTO') || (bodyNomor && bodyNomor !== 'AUTO');

        // Jika nomor diambil dari URL param (saat request PUT), pastikan payload body ikut terisi nomor tersebut
        if (urlNomor && urlNomor !== 'AUTO' && !req.body.Nomor) {
            req.body.Nomor = urlNomor;
        }

        // 2. Ambil kode user secara spesifik
        const userLogin = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || 'SYSTEM';

        // 3. Panggil service dengan 3 parameter sesuai urutan: (data, isUpdate, userLogin)
        const result = await service.saveBPB(req.body, isUpdate, userLogin);

        res.json({ 
            success: true, 
            message: isUpdate ? "Data berhasil diperbarui" : "Data berhasil disimpan",
            data: result 
        });
    } catch (err) {
        // Jika error dipicu oleh proteksi "PO sudah ada pembayaran", berikan status 400 Bad Request
        const isValidationError = err.message.includes("sudah ada pembayaran");
        res.status(isValidationError ? 400 : 500).json({ 
            success: false, 
            message: err.message 
        });
    }
};

exports.getById = async (req, res) => {
    try {
        const data = await service.getDetailByNomor(req.params.nomor);
        res.json({ success: true, data });
    } catch (err) {
        res.status(404).json({ success: false, message: err.message });
    }
};