const insentifService = require("../../services/penjualan/insentifService");

const getBrowseList = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate dan endDate wajib diisi.",
      });
    }
    const data = await insentifService.getBrowseList(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await insentifService.deleteData(nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const realisasiTransfer = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { tanggalRealisasi } = req.body;
    await insentifService.realisasiTransfer(nomor, tanggalRealisasi);
    res.status(200).json({
      success: true,
      message: "Realisasi transfer berhasil disimpan.",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getCetakData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await insentifService.getCetakData(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  deleteData,
  realisasiTransfer,
  getCetakData,
};
