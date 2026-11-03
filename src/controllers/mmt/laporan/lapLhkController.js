const lapLhkService = require('../../../services/mmt/laporan/lapLhkService');

/**
 * Mendapatkan ringkasan statistik agregasi untuk Dashboard
 * Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
const getLaporanAgregasi = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Tanggal boleh kosong: service men-skip klausa tanggal (tanpa zero-date).
    const data = await lapLhkService.getLaporanAgregasi(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Rekap LHK Per Mesin dan Harian untuk tampilan tabel/report
 * Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
const getRekapLhk = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Tanggal boleh kosong: service men-skip klausa tanggal (tanpa zero-date).
    const data = await lapLhkService.getRekapLhk(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Export CrossTab Mesin vs Hari dalam 1 Bulan
 * Query: ?month=MM&year=YYYY
 */
const getExportLhkCrossTab = async (req, res) => {
  try {
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        message: "Parameter month dan year wajib diisi",
      });
    }

    const data = await lapLhkService.getExportLhkCrossTab(month, year);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Export data detail lengkap ke Excel/CSV
 * Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&mesin=MESIN1,MESIN2
 */
const getAllDataForExport = async (req, res) => {
  try {
    const { startDate, endDate, mesin } = req.query;

    // Tanggal boleh kosong: service men-skip klausa tanggal (tanpa zero-date).
    const data = await lapLhkService.getAllDataForExport(
      startDate,
      endDate,
      mesin,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Detail pengerjaan SPK pada mesin tertentu
 * Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&mesin=NAMA_MESIN
 */
const getDetailRekapMesin = async (req, res) => {
  try {
    const { startDate, endDate, mesin } = req.query;

    if (!mesin) {
      return res.status(400).json({
        message: "Parameter mesin wajib diisi",
      });
    }

    // Tanggal boleh kosong: service men-skip klausa tanggal (tanpa zero-date).
    const data = await lapLhkService.getDetailRekapMesin(
      startDate,
      endDate,
      mesin,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getLaporanAgregasi,
  getRekapLhk,
  getExportLhkCrossTab,
  getAllDataForExport,
  getDetailRekapMesin,
};
