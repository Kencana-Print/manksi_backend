// backend/controllers/lapLsBahanPenolong.controller.js
const service = require('../../../services/mmt/laporan/lapLsBahanPenolongService');
const { format, startOfMonth } = require('date-fns');

exports.getReport = async (req, res) => {
  try {
    const endDate = req.query.endDate || format(new Date(), 'yyyy-MM-dd');
    const startDate = req.query.startDate || format(startOfMonth(new Date()), 'yyyy-MM-dd');

    const data = await service.getReport(startDate, endDate);
    res.json(data);
  } catch (error) {
    console.error('Gagal mengambil laporan bahan penolong:', error);
    res.status(500).json({ message: 'Gagal mengambil laporan bahan penolong', error: error.message });
  }
};