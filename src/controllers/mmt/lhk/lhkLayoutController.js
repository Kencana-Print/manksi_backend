const lhkLayoutService = require('../../../services/mmt/lhk/lhkLayoutService');

/**
 * Mendapatkan seluruh data gabungan LHK Layout (Header + 3 Grid Detail)
 * URL: GET /api/mmt/lhk-layout/load-all/:nomorSpk
 */
exports.getLhkLayoutList = async (req, res) => {
    try {
        const { startDate, endDate, search } = req.query;

        // Tanggal kosong = tanpa filter (diteruskan ke service yang me-skip klausa tanggal).

        const result = await lhkLayoutService.getLhkLayoutList({ startDate, endDate, search });
        
        // Kembalikan langsung berupa array [] agar cocok dengan `:items="masterData || []"` di Vue
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error di getLhkLayoutList:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Gagal memuat list data tabel LHK Layout.'
        });
    }
};

/**
 * Mendapatkan sub-detail expanded row untuk v-data-table frontend
 * URL: GET /api/mmt/lhk-layout/details?nomor=...
 */
exports.getLhkLayoutDetailsOnly = async (req, res) => {
    try {
        const { nomor } = req.query;
        if (!nomor) return res.status(400).json({ message: 'Parameter nomor wajib diisi.' });

        const details = await lhkLayoutService.getLhkLayoutDetailsOnly(nomor);
        return res.status(200).json({ details: details });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * Mendapatkan seluruh data gabungan LHK Layout saat membuka FORM EDIT
 * URL: GET /api/mmt/lhk-layout/load-all/:nomorSpk
 */
exports.getFullLhkLayout = async (req, res) => {
    try {
        const { nomorSpk } = req.params;

        if (!nomorSpk) {
            return res.status(400).json({
                success: false,
                message: 'Nomor SPK/MAP tidak boleh kosong.'
            });
        }

        const result = await lhkLayoutService.getFullLhkLayout(nomorSpk);

        if (!result) {
            return res.status(200).json({
                success: true,
                message: 'Data SPK/MAP tidak ditemukan.',
                data: { header: null, komponen: [] }
            });
        }

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error di getFullLhkLayout:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Gamenyediakan rincian data LHK Desain.'
        });
    }
};

/**
 * Menyimpan data LHK Layout (INSERT / UPDATE)
 * URL: POST /api/mmt/lhk-layout/save
 */
exports.saveLhkLayout = async (req, res) => {
    try {
        // Jika frontend mengirim via Form-Data multipart, parse dikerjakan di service.
        // Jika raw JSON (tanpa upload gambar), req.body bisa dibaca langsung.
        const result = await lhkLayoutService.saveLhkLayout(req, (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || 'OPERATOR');

        return res.status(200).json({
            success: true,
            message: 'Data LHK Layout berhasil disimpan.',
            nomorSpk: result.nomorSpk
        });
    } catch (error) {
        console.error('Error di saveLhkLayout:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Gagal menyimpan transaksi LHK Layout.'
        });
    }
};

/**
 * Validasi komponen bahan secara instan
 */
exports.validateBahan = async (req, res) => {
    try {
        const { kode } = req.query;
        if (!kode) return res.status(400).json({ message: 'Parameter kode wajib dikirim.' });

        const result = await lhkLayoutService.validateBahanLhk(kode);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};