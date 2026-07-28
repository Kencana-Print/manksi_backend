const service = require("../../services/garmen/approvePoInternalSpkFormService");

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getById(decodeURIComponent(nomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const saveApprove = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.saveApprove(
      decodeURIComponent(nomor),
      req.body,
      req.user,
    );
    res.json({
      success: true,
      message: result.mpNomor
        ? `Tersimpan dengan nomor ${result.mpNomor}`
        : "Approved.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { mpNomor } = req.params;
    const data = await service.getPrintData(decodeURIComponent(mpNomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getById,
  saveApprove,
  getPrintData,
};
