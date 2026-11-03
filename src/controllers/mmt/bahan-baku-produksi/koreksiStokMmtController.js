// backend/src/controllers/koreksiStokMmt.controller.js
// Catatan: File ini harus diimpor di router menggunakan require()

const service = require('../../../services/mmt/bahan-baku-produksi/koreksiStokMmtService'); // Menggunakan require
const { format } = require('date-fns'); // Menggunakan require

// READ MASTER (Browse)
// Di controller Anda
const getKoreksiStok = async (req, res) => {
    const { startDate, endDate } = req.query;

    try {
        // Tanggal kosong = tanpa filter (diteruskan ke service yang me-skip klausa tanggal).

        // Memanggil service yang menggabungkan master dan detail
        const data = await service.getKoreksiStokData(startDate, endDate);

        res.status(200).json({
            status: 'success',
            results: data.length,
            data: data
        });
    } catch (error) {
        console.error("Controller Error (getKoreksiStok):", error.message);
        res.status(500).json({
            status: 'error',
            message: "Gagal mengambil data: " + error.message
        });
    }
};

// backend/src/controllers/koreksiStokMmt.controller.js

const getStokGudangForKoreksi = async (req, res) => {
    const { gudangKode, tanggal } = req.query;

    try {
        // 2. Validasi apakah parameter ada
        if (!gudangKode) {
            return res.status(400).json({
                status: 'error',
                message: 'Gudang harus dipilih'
            });
        }

        // 3. Kirim ke service
        const data = await service.getStokGudangAll(gudangKode, tanggal);

        res.json({
            status: 'success',
            data: data
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// READ DETAIL (Expanded Row)
const getKoreksiStokDetail = async (req, res) => {
    const nomor = req.query.nomor || req.params.nomor;
    try {
        const data = await service.getKoreksiStokDetail(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getKoreksiStokByNomor = async (req, res) => {
    const nomor = req.params.nomor || req.query.nomor;
    try {
        const data = await service.getKoreksiStokDetail(nomor);
        if (!data) return res.status(404).json({ message: "Data koreksi stok tidak ditemukan." });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// DELETE
const deleteKoreksiStok = async (req, res) => {
    const { nomor } = req.params;
    const user = (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') || req.user?.id || 'SYSTEM';
    try {
        await service.deleteKoreksiStok(nomor, user);
        res.status(200).json({ message: "Koreksi Stok berhasil dihapus." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveKoreksiStok = async (req, res) => {
    try {
        const user = (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') || 'SYSTEM';
        const result = await service.saveKoreksiStokMMT(req.body, user);
        res.status(200).json({ status: 'success', message: 'Data berhasil disimpan', data: result });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

module.exports = {
    getKoreksiStok,
    getKoreksiStokDetail,
    getKoreksiStokByNomor,
    deleteKoreksiStok,
    getStokGudangForKoreksi,
    saveKoreksiStok
};

