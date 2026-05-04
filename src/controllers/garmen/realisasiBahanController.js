const service = require("../../services/garmen/realisasiBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Filter tanggal diperlukan." });
    }
    const data = await service.getBrowse(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetail(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getBrowseDetail(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await service.deleteData(nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const ajukanPerubahan = async (req, res) => {
  try {
    const userKode = req.user.kode; // Dari verifyToken middleware
    await service.ajukanPerubahan(req.body, userKode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getExportDetail,
  deleteData,
  ajukanPerubahan,
};
