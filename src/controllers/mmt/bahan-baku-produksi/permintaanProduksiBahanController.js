// backend/src/controllers/permintaanProduksiBahan.controller.js

const service = require('../../../services/mmt/bahan-baku-produksi/permintaanProduksiBahanService');

// 1. GET BROWSE
exports.getBrowse = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const userDivisi = req.user ? req.user.user_divisi || req.user.divisi : null;

        const data = await service.getPermintaanProduksiData(startDate, endDate, userDivisi);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. LOOKUP HISTORY
exports.getLookupPermintaan = async (req, res) => {
    try {
        const search = req.query.q || '';
        const userDivisi = req.user ? req.user.divisi || req.user.user_divisi : null;

        const data = await service.lookupPermintaanProduksi(search, userDivisi);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET DETAIL BY NOMOR
exports.getDetailByNomor = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getPermintaanProduksiDataByNomor(nomor);
        
        if (!data) {
            return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        }
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. SAVE (ADAPTIF & KEBAL FORMAT FLAT FRONTEND VUE)
exports.save = async (req, res) => {
    try {
        const username = req.user ? (req.user.username || (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM')) : 'SYSTEM';
        const isUpdate = req.body.isEditMode || req.body.isUpdate || (req.method === 'PUT') || false;
        
        const bodyData = req.body;
        const clientDetails = bodyData.details || [];
        
        let servicePayload;

        // ========================================================
        // JALUR 1: JIKA KATEGORI ADALAH MMT / TEKSTIL
        // ========================================================
        if (bodyData.kategori === "MMT/TEKSTIL") {
            // Mapping detail agar pas dengan loop `.map(d => ... d.sku, d.qtyMinta)` di service MMT
            const normalizedDetailsMmt = clientDetails.map((d) => ({
                sku: d.kode || '',
                qtyMinta: parseFloat(d.jumlah || 0),
                satuan: d.satuan || 'ROLL',
                spk: bodyData.spk || '0',
                keterangan: d.ket || ''
            }));

            // Bentuk objek PascalCase sesuai destrukturisasi `savePermintaanProduksi` MMT Anda
            servicePayload = {
                kategori: "MMT/TEKSTIL", // Penanda tambahan
                Nomor: bodyData.nomor || 'AUTO',
                Tanggal: bodyData.tanggal,
                GudangKode: bodyData.gudangAsalKode || bodyData.cabang || 'WH-16',
                Keterangan: bodyData.keterangan || '',
                Departemen: bodyData.divisi || 'CUTING',
                User: username,
                Details: normalizedDetailsMmt
            };
        } 
        // ========================================================
        // JALUR 2: JIKA KATEGORI ADALAH SUBLIM
        // ========================================================
        else {
            // Mapping detail agar pas dengan fungsi `saveMintaBahanSublim` (d.kode, d.jumlah, d.pcs, d.babaran)
            const normalizedDetailsSublim = clientDetails.map((d) => ({
                kode: d.kode || '',
                nama: d.nama || '',
                satuan: d.satuan || '',
                babaran: parseFloat(d.babaran || 0),
                pcs: parseFloat(d.pcs || 0),
                jumlah: parseFloat(d.jumlah || 0),
                komponen: d.komponen || 'BODY',
                ket: d.ket || ''
            }));

            // Bentuk objek camelCase huruf kecil sesuai file `saveMintaBahanSublim` Anda
            servicePayload = {
                kategori: "SUBLIM",
                nomor: bodyData.nomor || '',
                tanggal: bodyData.tanggal,
                cabang: bodyData.cabang || 'P04',
                divisi: bodyData.divisi || 'CUTING',
                spk: bodyData.spk || '',
                keterangan: bodyData.keterangan || '',
                pin_acc: bodyData.pin_acc || '',
                pin_dipakai: bodyData.pin_dipakai || '',
                details: normalizedDetailsSublim
            };
        }
        
        // Panggil service utama
        const result = await service.savePermintaanProduksi(servicePayload, isUpdate);
        
        return res.status(200).json({
            success: true,
            message: 'Permintaan bahan produksi berhasil disimpan',
            nomor: result.nomor
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
// 5. REMOVE
exports.remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await service.deletePermintaanProduksi(nomor);
        res.json({ success: true, message: 'Data terhapus', affectedRows: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getSpkDetailsAndMkb = async (req, res) => {
    try {
        const { nomor } = req.params; // nomor di sini adalah nomor SPK dari URL
        const cabang = req.query.cabang || '';
        const keterangan = req.query.keterangan || '';
        const isEdit = req.query.isEdit === 'true' || req.query.isEdit === true;

        const data = await service.getSpkDetailsAndMkb(nomor, cabang, keterangan, isEdit);
        
        // Dibungkus standar { success: true, data } agar dibaca mulus oleh Vue
        res.status(200).json({ 
            success: true, 
            data: data 
        });
    } catch (error) {
        // Jika ada throw Error validasi dari service, kirim status 400 beserta pesan aslinya
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
};