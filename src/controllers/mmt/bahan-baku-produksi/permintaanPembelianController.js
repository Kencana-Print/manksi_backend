const permintaanPembelianService = require('../../../services/mmt/bahan-baku-produksi/permintaanPembelianService');
const { format } = require('date-fns');

exports.getAll = async (req, res) => {
    try {
        const dateNow = new Date();
        const dateStart = req.query.startDate || format(new Date(new Date().setDate(dateNow.getDate() - 365)), 'yyyy-MM-dd');
        const dateEnd = req.query.endDate || format(new Date(), 'yyyy-MM-dd');
        const data = await permintaanPembelianService.getPengajuanData(dateStart, dateEnd);
        res.json({ data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getByNomor = async (req, res) => {
    try {
        const data = await permintaanPembelianService.getPengajuanByNomor(req.params.nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

exports.save = async (req, res) => {
    try {
        const user = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM');
        const result = await permintaanPembelianService.savePengajuan(req.body, req.body.NomorToEdit, user);
        res.json({ message: 'Berhasil menyimpan permintaan pembelian', nomor: result.Nomor });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.lookupPengajuan = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Logika untuk menangani jika tanggal kosong
        const dateNow = new Date();
        // Default startDate adalah 30 hari yang lalu
        const dateStart = startDate || format(new Date(new Date().setDate(dateNow.getDate() - 30)), 'yyyy-MM-dd');
        const dateEnd = endDate || format(new Date(), 'yyyy-MM-dd');

        const data = await permintaanPembelianService.getPengajuanForLookup(dateStart, dateEnd);

        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat data lookup permintaan pembelian.",
            error: error.message
        });
    }
};

exports.getPengajuanForPrint = async (req, res) => {
    try {
        const { nomor } = req.params;
        if (!nomor) return res.status(400).json({ message: "Nomor permintaan pembelian wajib diisi." });

        const data = await permintaanPembelianService.getPermintaanPembelianForPrint(nomor);
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ 
            message: "Gagal memuat data cetak.", 
            error: error.message 
        });
    }
};

exports.approvePengajuan = async (req, res) => {
    try {
        const { nomor } = req.body;
        
        // Ambil kode user dari token (Middleware verifyToken)
        const userKD = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || req.user.user_nama;

        if (!nomor) {
            return res.status(400).json({ message: "Nomor permintaan pembelian wajib dikirim." });
        }

        const success = await permintaanPembelianService.approveBySPV(nomor, userKD);

        if (success) {
            res.json({ message: "permintaan pembelian berhasil di-ACC oleh SPV." });
        } else {
            res.status(404).json({ message: "Gagal ACC. Nomor permintaan pembelian tidak ditemukan." });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        await permintaanPembelianService.deletePengajuan(nomor);
        res.json({ message: `permintaan pembelian ${nomor} berhasil dihapus.` });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

