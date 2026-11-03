const lapSpkMmtService = require('../../../services/mmt/laporan/lapSpkMmtService');

const isValidDateInput = (value) => {
    if (!value) return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime());
};

exports.getReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
            return res.status(400).json({
                message:
                    "Parameter startDate dan endDate wajib diisi (format tanggal valid).",
            });
        }

        const data = await lapSpkMmtService.getReport(startDate, endDate);
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(500).json({
            message: "Gagal mengambil laporan SPK MMT",
            error: error.message,
        });
    }
};
