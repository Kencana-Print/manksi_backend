
const mesinService = require("../../../services/mmt/daftar/mesinMmtService");

// 1. READ ALL / Lookup (F1 di Delphi)
exports.getLookupMesin = async (req, res) => {
    try {
        const keyword = req.query.q || "";
        const data = await mesinService.getLookupMesin(keyword);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat daftar bantuan mesin.",
            error: error.message,
        });
    }
};

// 2. GET BY KODE (Logika loaddata di Delphi)
exports.getMesinDetail = async (req, res) => {
    try {
        const { kode } = req.params;
        if (!kode) {
            return res.status(400).json({ message: "Kode tidak boleh kosong" });
        }
        
        const data = await mesinService.getMesinByKode(kode);
        
        // Di Delphi, jika data tidak ditemukan, FLAGEDIT = False (tetap sukses tapi data kosong)
        if (!data) {
            return res.status(200).json({ 
                data: null, 
                message: "Kode tidak ditemukan, siap input data baru." 
            });
        }
        
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal memuat detail mesin.",
            error: error.message,
        });
    }
};

// 3. SAVE DATA (Logika simpandata di Delphi)
exports.saveMesin = async (req, res) => {
    try {
        // Cek autentikasi (verifyToken)
        if (!req.user) {
            return res.status(401).json({ message: "Sesi anda berakhir, silakan login kembali." });
        }

        const { msn_kode, msn_nama } = req.body;

        // Validasi di Delphi: if (edtKode.Text = '') then ...
        if (!msn_kode || String(msn_kode).trim() === "") {
            return res.status(400).json({ message: "Kode tidak boleh Kosong" });
        }
        
        if (!msn_nama || String(msn_nama).trim() === "") {
            return res.status(400).json({ message: "Nama mesin tidak boleh Kosong" });
        }

        const result = await mesinService.saveMesin(req.body);
        
        return res.status(200).json({ 
            message: `Tersimpan dengan kode: ${result.kode}`,
            kode: result.kode 
        });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal Simpan",
            error: error.message,
        });
    }
};

// 4. DELETE DATA (Logika hapusdata di Delphi)
exports.deleteMesin = async (req, res) => {
    try {
        const { kode } = req.params;
        const result = await mesinService.deleteMesin(kode);
        
        if (!result) {
            return res.status(404).json({ message: "Data gagal dihapus atau kode tidak ditemukan." });
        }

        return res.status(200).json({ message: "Data berhasil dihapus" });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal hapus",
            error: error.message,
        });
    }
};