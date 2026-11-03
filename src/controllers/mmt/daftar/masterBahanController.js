const bahanService = require("../../../services/mmt/daftar/masterBahanService");

// 1. READ ALL (Browse)
exports.getMasterBahan = async (req, res) => {
    try {
        const zdivisi = req.query.zdivisi ?? null;
        const keyword = req.query.q ?? req.query.search ?? "";
        const page = req.query.page ? parseInt(req.query.page, 10) : null;
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
        const result = await bahanService.getBahanData({ zdivisi, keyword, page, limit });
        if (page !== null && limit !== null) {
            return res.status(200).json({
                data: result.items,
                total: result.total,
                page: result.page,
                limit: result.limit,
            });
        }
        return res.status(200).json({ data: result });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat daftar barang.",
            error: error.message,
        });
    }
};

// 2. GET BY KODE (Load for Edit)
exports.getBahanDetail = async (req, res) => {
    try {
        const { kode } = req.params;
        if (!String(kode || "").trim()) {
            return res
                .status(400)
                .json({ message: "Kode barang wajib diisi." });
        }
        const data = await bahanService.getBahanByKode(kode);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(404).json({
            message: "Kode Barang tidak ditemukan.",
            error: error.message,
        });
    }
};

// GET detail khusus endpoint mmt/:kode (dipakai flow lookup/form MMT)
exports.getBahanDetailMmt = async (req, res) => {
    try {
        const { kode } = req.params;
        const data = await bahanService.getBahanDetailByKodeMmt(kode);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(404).json({
            message: "Kode Bahan tidak ditemukan.",
            error: error.message,
        });
    }
};

exports.lookupBahanProduksiMMt = async (req, res) => {
    try {
        const keyword = req.query.q || "";
        const data = await bahanService.getLookupGdgProduksiMMT(keyword);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat data lookup.",
            error: error.message,
        });
    }
};

exports.saveMasterBahan = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const userLogin = String(
            (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') ||
                req.user?.KDUSER ||
                req.user?.username ||
                req.user?.user_nama ||
                req.user?.user ||
                "SYSTEM",
        );
        const result = await bahanService.saveBahan(req.body, userLogin);
        return res
            .status(200)
            .json({ message: "Simpan berhasil", kode: result.kode });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal simpan master barang.",
            error: error.message,
        });
    }
};

exports.lookupKategori = async (req, res) => {
    try {
        const q = String(req.query.q || "");
        const data = await bahanService.getLookupKategori(q);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat lookup kategori.",
            error: error.message,
        });
    }
};

exports.lookupGudang = async (req, res) => {
    try {
        const q = String(req.query.q || "");
        const data = await bahanService.getLookupGudang(q);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat lookup gudang.",
            error: error.message,
        });
    }
};

exports.lookupSupplier = async (req, res) => {
    try {
        const q = String(req.query.q || "");
        const data = await bahanService.getLookupSupplier(q);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat lookup supplier.",
            error: error.message,
        });
    }
};

exports.lookupJenis = async (req, res) => {
    try {
        const q = String(req.query.q || "");
        const data = await bahanService.getLookupJenis(q);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat lookup jenis.",
            error: error.message,
        });
    }
};

exports.lookupDivisi = async (req, res) => {
    try {
        const q = String(req.query.q || "");
        const data = await bahanService.getLookupDivisi(q);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat lookup divisi.",
            error: error.message,
        });
    }
};
