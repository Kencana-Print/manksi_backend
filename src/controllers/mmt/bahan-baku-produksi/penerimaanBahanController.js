// backend/src/controllers/penerimaanBahanController.js

const penerimaanBahanService = require('../../../services/mmt/bahan-baku-produksi/penerimaanBahanService');

// ===================================
// READ ALL (btnRefreshClick)
// ===================================
exports.getRecMmt = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        const start = startDate || defaultStart.toISOString().slice(0, 10);
        const end = endDate || new Date().toISOString().slice(0, 10);

        // Menggunakan nama fungsi dari service
        const data = await penerimaanBahanService.getRecMmtData(start, end);

        return res.status(200).json({
            message: 'Pengambilan data transaksi berhasil.',
            data: data
        });

    } catch (error) {
        console.error('Error in getRecMmt controller:', error.message);
        return res.status(500).json({
            message: "Gagal mengambil data transaksi Penerimaan MMT.",
            error: error.message
        });
    }
};

// ===================================
// DELETE (cxButton4Click)
// ===================================
exports.deleteRecMmt = async (req, res) => {
    try {
        const { nomor } = req.params;

        // Cek Status Receipt
        const status = await penerimaanBahanService.checkRecStatus(nomor);
        if (status === 1) {
            return res.status(403).json({
                message: `Gagal Hapus. Transaksi ${nomor} sudah diproses (Status Receipt: 1).`
            });
        }

        // Lakukan Penghapusan
        const isDeleted = await penerimaanBahanService.deleteRecMmt(nomor);

        if (isDeleted) {
            return res.status(200).json({
                message: `Data berhasil di Hapus.`
            });
        }

        return res.status(404).json({
            message: `Gagal Hapus. Nomor ${nomor} tidak ditemukan.`
        });


    } catch (error) {
        console.error('Error deleting transaction:', error.message);
        return res.status(500).json({
            message: "Gagal Hapus.",
            error: error.message
        });
    }
};

// ===================================
// CHECK STATUS BEFORE EDIT
// ===================================
exports.checkEditStatus = async (req, res) => {
    try {
        const { nomor } = req.params;
        const status = await penerimaanBahanService.checkRecStatus(nomor);

        if (status === 1) {
            return res.status(200).json({
                canEdit: false,
                message: "Transaksi ini sudah ada Receipt Barang, Tidak dapat di edit."
            });
        }

        return res.status(200).json({
            canEdit: true,
            message: "Transaksi siap diedit."
        });

    } catch (error) {
        res.status(500).json({ message: 'Gagal mengecek status edit.', error: error.message });
    }
};


exports.getRecMmtById = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await penerimaanBahanService.loadRecMmtById(nomor);

        if (!data) {
            // Replikasi ShowMessage('Nomor so tidak di temukan')
            return res.status(404).json({ message: "Nomor transaksi tidak ditemukan." });
        }
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat data transaksi.', error: error.message });
    }
};

// ===================================
// CREATE & UPDATE (simpandata)
// ===================================
exports.saveRecMmt = async (req, res) => {
    console.log("BODY MASUK:", JSON.stringify(req.body, null, 2));
    try {
        const data = req.body;
        const nomorToEdit = req.params.nomor || null;
        const currentUser = req.user ? (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') : 'SYSTEM';

        // --- Validasi awal sebelum kirim ke service ---
        if (!data.header?.supplier_kode || !data.header?.gudang_kode) {
            return res.status(400).json({
                message: 'Validasi Gagal.',
                error: 'Supplier dan Kode Gudang wajib diisi.'
            });
        }

        if (!data.details || data.details.length === 0) {
            return res.status(400).json({
                message: 'Validasi Gagal.',
                error: 'Detail item wajib diisi.'
            });
        }

        // --- Simpan ---
        const result = await penerimaanBahanService.saveRecMmt(data, nomorToEdit, currentUser);

        res.status(200).json({
            message: 'Data berhasil disimpan.',
            data: result
        });

    } catch (error) {
        res.status(500).json({ message: 'Gagal Simpan.', error: error.message });
    }
};

exports.getGeneratedBarcodes = async (req, res) => {
    try {
        const { nomor } = req.params;

        if (!nomor) {
            return res.status(400).json({
                success: false,
                message: "Nomor referensi (transaksi) tidak ditemukan."
            });
        }

        // Memanggil fungsi service yang sudah kita buat sebelumnya
        const barcodes = await penerimaanBahanService.getBarcodesByNomor(nomor);

        if (barcodes.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Barcode belum di-generate atau transaksi tidak memiliki detail barang."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Daftar barcode berhasil diambil.",
            data: barcodes
        });

    } catch (error) {
        console.error("Error in getGeneratedBarcodes Controller:", error.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data barcode dari database.",
            error: error.message
        });
    }
};


exports.lookupPO = async (req, res) => {
    const keyword = req.query.q || '';
    try {
        const data = await penerimaanBahanService.getPOLookupData(keyword);
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// GET /api/penerimaan/po/:nomor
exports.getPODetail = async (req, res) => {
    const poNomor = req.params.nomor;
    try {
        const data = await penerimaanBahanService.getPODetail(poNomor);
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// controllers/penerimaanBahan.controller.js

exports.lookupPenerimaan = async (req, res) => {
    try {
        const q = req.query.q || ''; // ← NORMALISASI
        const data = await penerimaanBahanService.getRecLookupForInvoice(q);

        res.status(200).json({
            success: true,
            data
        });

    } catch (error) {
        console.error('lookupPenerimaan ERROR:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


exports.getDetailPenerimaan = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await penerimaanBahanService.getRecDetailForInvoice(nomor);

        res.status(200).json({
            success: true,
            data
        });

    } catch (error) {
        console.error('getDetailPenerimaan ERROR:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


exports.printPenerimaanBahan = async (req, res) => {
    try {
        const { nomor } = req.params;

        if (!nomor) {
            return res.status(400).json({
                success: false,
                message: "Nomor penerimaan wajib diberikan."
            });
        }

        const data = await penerimaanBahanService.getPenerimaanBahanForPrint(nomor);

        res.status(200).json({
            success: true,
            data
        });

    } catch (error) {
        console.error('printPenerimaanBahan ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data untuk print.',
            error: error.message
        });
    }
};