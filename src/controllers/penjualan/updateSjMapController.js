const updateSjService = require("../../services/penjualan/updateSjMapService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter tanggal diperlukan." });
    }
    const data = await updateSjService.getBrowseData(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Mengambil detail SJ (Header & Detail Barang) untuk ditampilkan di Dialog
 */
const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await updateSjService.getSjDetailForUpdate(nomor);
    if (!data.header) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getOptions = async (req, res) => {
  try {
    const data = await updateSjService.getStatusOptions();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const { nomor } = req.params;
    await updateSjService.updateStatusSj(nomor, req.body, userKode);
    res.status(200).json({
      success: true,
      message: "Status Surat Jalan berhasil diperbarui.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getDetail, getOptions, updateStatus };
