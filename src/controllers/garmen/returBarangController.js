const returBarangService = require("../../services/garmen/returBarangService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang, jenis } = req.query;
    if (!startDate || !endDate || !jenis) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate, endDate, dan jenis wajib diisi.",
      });
    }

    const data = await returBarangService.getBrowseData(
      startDate,
      endDate,
      cabang,
      jenis,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await returBarangService.deleteData(nomor, req.user);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestEdit = async (req, res) => {
  try {
    if (!req.body.alasan) {
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan wajib diisi." });
    }
    await returBarangService.ajukanPerubahan(req.body, req.user);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteData,
  requestEdit,
};
