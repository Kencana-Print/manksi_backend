const reportService = require('../../../services/mmt/laporan/lapPemakaianBahanService');

exports.getProductionWaste = async (req, res) => {
  try {
    // 1. Tangkap parameter tipeLhk dari query URL
    const { startDate, endDate, mesin, tipeLhk } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        message: "Tanggal mulai dan selesai harus diisi",
      });
    }

    // 2. Oper tipeLhk ke service
    const data = await reportService.getFullProductionReport(
      startDate,
      endDate,
      mesin,
      tipeLhk,
    );

    // 3. Kembalikan array data bersih (Clean Array)
    // NOTE: Pushing 'summary' ke array data dihapus karena Frontend Vue.js
    // sudah menghitung Grand Total secara dinamis dari filteredData.
    // Memasukkan summary ke array data akan menyebabkan data terhitung ganda di frontend.
    return res.status(200).json(data);
  } catch (error) {
    console.error("Controller Error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
