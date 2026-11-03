const mutasiInternalService = require('../../../../services/mmt/transaksi-khusus/spk-order/mutasiInternalService');

// Ambil identitas user yang login. JWT MMT memakai kdUser, sedangkan
// middleware lain bisa memakai kode/username. Fallback terakhir SYSTEM
// hanya untuk request tanpa autentikasi sama sekali.
const getLoginUser = (req) =>
    (req.user?.nama || req.user?.username || req.user?.kode || 'SYSTEM') ||
    (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') ||
    req.user?.kode ||
    (req.user?.kode || req.user?.kdUser || req.user?.nama || 'SYSTEM') ||
    "SYSTEM";

exports.createMutasi = async (req, res) => {
    try {
        const dataPayload = {
            Nomor: req.body.header?.nomor,
            Tanggal: req.body.header?.tanggal,
            GudangAsal: req.body.header?.bagian_asal,
            GudangTujuan: req.body.header?.bagian_tujuan,
            Keterangan: req.body.header?.keterangan,
            Type: req.body.header?.type,
            Cabang: req.user?.cabang || req.user?.cab,
            Details: req.body.details
        };

        const result = await mutasiInternalService.saveMutasiInternal(dataPayload, false, getLoginUser(req));
        res.status(201).json({
            success: true,
            message: "Data mutasi internal berhasil disimpan",
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateMutasi = async (req, res) => {
    try {
        const { nomor } = req.params;
        const dataPayload = {
            Nomor: nomor,
            Tanggal: req.body.header?.tanggal,
            GudangAsal: req.body.header?.bagian_asal,
            GudangTujuan: req.body.header?.bagian_tujuan,
            Keterangan: req.body.header?.keterangan,
            Type: req.body.header?.type,
            Cabang: req.user?.cabang || req.user?.cab,
            Details: req.body.details
        };
        
        const result = await mutasiInternalService.saveMutasiInternal(dataPayload, true, getLoginUser(req));
        res.status(200).json({
            success: true,
            message: `Data mutasi internal ${nomor} berhasil diperbarui`,
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET ALL MASTER (Untuk Browse Utama)
exports.getAllMutasi = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: "Filter tanggal (startDate & endDate) diperlukan" });
        }
        
        const rawData = await mutasiInternalService.getMutasiData(
            startDate,
            endDate,
            getLoginUser(req)
        );
        
        // Pastikan format key sesuai dengan masterHeaders di Vue:
        // { title: "No. Mutasi", key: "Nomor_Mutasi" }, { title: "Tanggal", key: "Tanggal" }, dsb.
        const mappedData = rawData.map(item => ({
            Nomor_Mutasi: item.Nomor_Mutasi,
            Tanggal: item.Tanggal, // Format dari service sudah 'dd-MMM-yyyy' (custom parsing di Vue)
            Bagian_Asal: item.Bagian_Asal,
            Bagian_Tujuan: item.Bagian_Tujuan,
            Total_Qty: item.Total_Qty,
            Keterangan: item.Keterangan,
            Status: item.Status
        }));

        // Frontend membaca: res.data.data
        res.status(200).json({ success: true, data: mappedData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET DETAIL BY NOMOR (Untuk Expand Row & Load Edit Data)
exports.getDetailMutasi = async (req, res) => {
    try {
        const { nomor } = req.params;
        const rawDetails = await mutasiInternalService.getMutasiDetailByNomor(nomor);
        
        // Sesuaikan dengan detailHeaders & detailData mapping di frontend:
        const mappedDetails = rawDetails.map(d => ({
            Id: d.Lhk_Detail_Id, // Referensi ID untuk handleLhkSelect / loadDataMutasi
            Lhk_Detail_Id: d.Lhk_Detail_Id,
            Nomor_Mutasi: d.Nomor_Mutasi,
            Nomor_SPK: d.Nomor_SPK,
            Nama_SPK: d.Nama_SPK, // Diperlukan untuk kolom "Nama Order"
            No_PO_Internal: d.No_PO_Internal,
            Size: d.Size,
            Nama_Komponen: d.Nama_Komponen,
            Qty_Mutasi: d.Qty_Mutasi,
            Stok_Sublim_Lama: d.Stok_Sublim_Lama,
            Tanggal: d.Tanggal,
            Bagian_Asal: d.Bagian_Asal,
            Bagian_Tujuan: d.Bagian_Tujuan,
            Keterangan: d.Keterangan
        }));

        res.status(200).json({ success: true, data: mappedDetails });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteMutasi = async (req, res) => {
    try {
        const { nomor } = req.params;
        await mutasiInternalService.deleteMutasiInternal(nomor);
        res.status(200).json({ success: true, message: `Dokumen mutasi internal ${nomor} berhasil dihapus` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.generateNomor = async (req, res) => {
    try {
        const nomor = await mutasiInternalService.getNewNomorMutasi();
        res.status(200).json({ success: true, nomor });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};