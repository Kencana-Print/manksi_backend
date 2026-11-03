// backend/src/controllers/planningProduksi.controller.js

const planningService = require('../../../../services/mmt/transaksi-khusus/spk-order/planningProduksiService');

exports.getBrowsePlanning = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        // Tanggal kosong = tanpa filter (diteruskan ke service yang me-skip klausa tanggal).

        const data = await planningService.getPlanningProduksiData(startDate, endDate);
        
        // Ubah properti Detail -> detail untuk standarisasi javascript camelCase
        const formattedData = data.map(item => ({
            ...item,
            detail: item.Detail || []
        }));

        return res.status(200).json({
            success: true,
            data: formattedData
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

exports.getDetailPlanning = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await planningService.getPlanningByNomor(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
};


exports.getSpkDetailForPlanning = async (req, res) => {
    try {
        const { nomorSpk } = req.params; 

        if (!nomorSpk) {
            return res.status(400).json({ 
                success: false, 
                message: "Nomor SPK wajib dilampirkan." 
            });
        }

        // result berisi: { spk_nomor, spk_nama, spk_panjang, ..., Detail: [...] }
        const result = await planningService.getPlanningByNomor(nomorSpk);
        
        // Validasi apakah data master SPK ditemukan (cek salah satu field utama, misal spk_nomor)
        if (!result || !result.spk_nomor) {
            return res.status(404).json({ 
                success: false, 
                message: "Nomor SPK tidak ditemukan di sistem database." 
            });
        }

        // Mapping output yang disesuaikan dengan kebutuhan komponen Form Vue Anda
        return res.status(200).json({
            success: true,
            data: {
                header: {
                    spk_nomor: result.spk_nomor,
                    spk_Nama: result.spk_nama,
                    tgl: result.spk_tanggal,       // Sesuaikan dengan nama kolom asli tSPK Anda
                    dateline: result.spk_dateline, // Sesuaikan dengan nama kolom asli tSPK Anda
                    spk_jumlah: result.spk_jumlah,
                    spk_panjang: result.spk_panjang,
                    spk_lebar: result.spk_lebar,
                    spk_cab: result.spk_cab,
                    spk_workshop: result.spk_workshop,
                    spk_tipe: result.spk_tipe,
                    spk_kain: result.spk_kain,
                    spk_Finishing: result.spk_finishing,
                    spk_sablon: result.sablon || result.spk_sablon,
                    spk_sublim: result.sublim || result.spk_sublim,
                    spk_bordir: result.bordir || result.spk_bordir
                },
                // Pastikan key "detail" menggunakan huruf kecil sesuai kebutuhan .map() di Vue
                detail: result.Detail || [] 
            }
        });

    } catch (error) {
        console.error("Error di getSpkDetailForPlanning:", error);
        return res.status(500).json({ 
            success: false, 
            message: `Gagal memproses data SPK: ${error.message}` 
        });
    }
};

exports.savePlanning = async (req, res) => {
    try {
        const result = await planningService.savePlanningProduksi(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};