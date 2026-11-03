// backend/controllers/lapLsBahanUtama.controller.js
const service = require('../../../services/mmt/laporan/lapLsBahanUtamaService');
const { format, startOfMonth } = require('date-fns');

exports.getReport = async (req, res) => {
  try {
    const endDate = req.query.endDate || format(new Date(), 'yyyy-MM-dd');
    const startDate = req.query.startDate || format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const gdgKode = req.query.gdgKode || 'WH-16'; // default gudang utama

    const data = await service.getReport(startDate, endDate, gdgKode);

    res.json(data);
  } catch (error) {
    console.error('Gagal mengambil laporan:', error);
    res.status(500).json({ 
      message: 'Gagal mengambil laporan', 
      error: error.message 
    });
  }
};

exports.getReportDetail = async (req, res) => {
  try {
    const { startDate, endDate, gdgKode, brgKode } = req.query;

    if (!startDate || !endDate || !brgKode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Parameter tidak lengkap (startDate, endDate, dan brgKode wajib diisi).' 
      });
    }

    // Memanggil fungsi detail yang berada di service
    const detailData = await service.getReportDetailByItem(startDate, endDate, gdgKode, brgKode);

    res.json({
      success: true,
      data: detailData
    });
  } catch (error) {
    console.error('Gagal mengambil detail laporan:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil detail laporan', 
      error: error.message 
    });
  }
};

// Fungsi Baru untuk Total Roll Saat Ini
exports.getTotalRoll = async (req, res) => {
  try {
    const summary = await service.getTotalRollSekarang();
    res.json({
      success: true,
      timestamp: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      data: summary
    });
  } catch (error) {
    console.error('Gagal mengambil total roll:', error);
    res.status(500).json({ message: 'Gagal mengambil ringkasan stok', error: error.message });
  }
};

exports.getFlow6Bulan = async (req, res) => {
  try {
    const data = await service.getFlow6Bulan(); // Panggil fungsi query 6 bulan
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('Gagal mengambil flow 6 bulan:', error);
    res.status(500).json({ message: 'Gagal mengambil data flow', error: error.message });
  }
};

exports.getGudangList = async (req, res) => {
  try {
    const list = await service.getGudangList();
    res.json(list);
  } catch (error) {
    console.error('Gagal mengambil daftar gudang:', error);
    res.status(500).json({ message: 'Gagal mengambil daftar gudang', error: error.message });
  }
};