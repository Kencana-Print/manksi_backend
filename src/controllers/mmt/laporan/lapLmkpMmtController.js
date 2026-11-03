const lmkpService = require('../../../services/mmt/laporan/lapLmkpMmtService');

exports.getLaporan = async (req, res) => {
    try {
        const { jenisIndex, startDate, endDate } = req.query;

        if (!jenisIndex || !startDate || !endDate) {
            return res.status(400).json({ message: "Parameter query tidak lengkap" });
        }

        // Ambil data utama dan kapasitas mesin secara paralel
        const [data, kapasitas] = await Promise.all([
            lmkpService.getMonitoringData(jenisIndex, startDate, endDate),
            lmkpService.getKapasitasMesin(jenisIndex)
        ]);

        // Hitung total kekurangan untuk "Waiting List Kerja" (Footer logic)
        const totalKekurangan = data.reduce((acc, curr) => acc + (curr.krg_Cetak || 0), 0);
        const estimasiHari = kapasitas > 0 ? (totalKekurangan / kapasitas).toFixed(2) : 0;

        res.status(200).json({
            status: 'success',
            summary: {
                outputPerHari: kapasitas,
                totalWaitingList: totalKekurangan,
                estimasiSelesaiHari: estimasiHari
            },
            data: data
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};