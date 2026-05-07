const invoiceProformaService = require("../../services/penjualan/invoiceProformaService");

const getBrowseList = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Filter startDate dan endDate wajib diisi.",
        });
    }
    const data = await invoiceProformaService.getBrowseList(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Filter startDate dan endDate wajib diisi.",
        });
    }
    const data = await invoiceProformaService.getExportDetail(
      startDate,
      endDate,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await invoiceProformaService.deleteData(nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin5 = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    if (!nomor || !alasan) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Nomor dan alasan pengajuan wajib diisi.",
        });
    }
    await invoiceProformaService.requestPin5(nomor, alasan, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  getExportDetail,
  deleteData,
  requestPin5,
};
