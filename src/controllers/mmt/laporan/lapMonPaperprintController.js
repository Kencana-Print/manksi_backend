const reportService = require('../../../services/mmt/laporan/lapMonPaperprintService');

async function lapMonCetakPaperprint(req, res) {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: "Parameter startDate dan endDate wajib diisi!",
    });
  }

  try {
    const data = await reportService.lapMonCetakPaperprint(startDate, endDate);

    return res.status(200).json({
      success: true,
      message: "Berhasil mengambil data laporan monitoring cetak paperprint",
      total_rows: data.length,
      data: data,
    });
  } catch (error) {
    console.error("Error lapMonCetakPaperprint:", error);
    return res.status(500).json({
      success: false,
      message:
        "Terjadi kesalahan server saat mengambil laporan monitoring paperprint",
      error: error.message,
    });
  }
}

module.exports = { lapMonCetakPaperprint };
