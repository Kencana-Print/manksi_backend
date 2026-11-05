// backend/controllers/lapKartuStok.controller.js
const lapKartuStokService = require('../../../../services/mmt/bahan-baku-produksi/barcode/kartuBarcodeService');

/**
 * Controller Rekapitulasi Kartu Stok (Master)
 * Query Params: startDate, endDate, gdgKode
 */
const getSummary = async (req, res) => {
  try {
    const { startDate, endDate, gdgKode } = req.query;

    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const start = startDate || defaultStart.toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const data = await lapKartuStokService.getKartuStokSummary(start, end, gdgKode);

    return res.status(200).json({
      success: true,
      message: 'Berhasil mengambil rekapitulasi kartu stok',
      totalRows: data.length,
      data
    });
  } catch (error) {
    console.error('Error in getSummary:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: error.message
    });
  }
};

/**
 * Controller Detail Mutasi Kartu Stok
 * Query Params: startDate, endDate, gdgKode, brgKode (opsional)
 */
const getDetail = async (req, res) => {
  try {
    const { startDate, endDate, gdgKode, brgKode } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Parameter startDate dan endDate wajib diisi.'
      });
    }

    const data = await lapKartuStokService.getKartuStokDetail(startDate, endDate, gdgKode, brgKode);

    return res.status(200).json({
      success: true,
      message: 'Berhasil mengambil detail transaksi kartu stok',
      totalRows: data.length,
      data
    });
  } catch (error) {
    console.error('Error in getDetail:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: error.message
    });
  }
};

module.exports = {
  getSummary,
  getDetail
};