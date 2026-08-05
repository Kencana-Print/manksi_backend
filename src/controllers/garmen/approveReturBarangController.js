const service = require("../../services/garmen/approveReturBarangService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, jenis } = req.query;
    if (!startDate || !endDate || !jenis) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate, endDate, dan jenis wajib diisi.",
      });
    }
    const data = await service.getBrowseData(startDate, endDate, jenis);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getApprovalDetail = async (req, res) => {
  try {
    const { logNomor } = req.params;
    const { noApprov } = req.query;
    const data = await service.getApprovalDetail(logNomor, noApprov || "");
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveApproval = async (req, res) => {
  try {
    const nomor = await service.saveApproval(req.body, req.user);
    res.status(200).json({
      success: true,
      data: { nomor },
      message: `Berhasil di approve dengan nomor: ${nomor}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const cancelApproval = async (req, res) => {
  try {
    const { noApprov } = req.params;
    await service.cancelApproval(noApprov, req.user);
    res.status(200).json({ success: true, message: "Berhasil dibatalkan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getApprovalDetail,
  saveApproval,
  cancelApproval,
};
