const brgJadiService = require('../../../../services/mmt/transaksi-khusus/pengiriman/stbjMmtService');
const { subDays } = require('date-fns');

exports.getReport = async (req, res) => {
  try {
    // undefined (param tak dikirim) = default 30 hari; string kosong "" = tanpa filter tanggal.
    const qEnd = req.query.endDate;
    const endDate = qEnd === undefined ? new Date() : qEnd;
    const qStart = req.query.startDate;
    const startDate = qStart === undefined ? subDays(new Date(endDate), 30) : qStart;
    
    const data = await brgJadiService.getReport(startDate, endDate);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil laporan barang jadi', error: error.message });
  }
};