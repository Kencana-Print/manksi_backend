const kendalaService = require("../../services/master/kendalaService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi",
      });
    }
    const data = await kendalaService.getBrowse(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await kendalaService.remove(req.params.nomor);
    res
      .status(200)
      .json({ success: true, message: "Kendala berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const exportExcel = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi",
      });
    }
    const wb = await kendalaService.buildExportWorkbook(startDate, endDate);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Laporan_Kendala_${startDate}_${endDate}.xlsx`,
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, remove, exportExcel };
