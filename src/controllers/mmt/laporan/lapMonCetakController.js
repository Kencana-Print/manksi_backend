const reportService = require('../../../services/mmt/laporan/lapMonCetakService');

async function lapMonCetak(req, res) {

  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      message: 'Parameter startDate dan endDate wajib diisi'
    });
  }

  try {
    const data = await reportService.lapMonCetak(
      startDate,
      endDate
    );

    res.json(data);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Terjadi kesalahan server'
    });
  }
}

module.exports = { lapMonCetak };
