const service = require("../../services/garmen/approvePoInternalSpkService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowseList(req.query, req.user.cabang);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetailByNomor(decodeURIComponent(nomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkApprovable = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.checkApprovable(decodeURIComponent(nomor));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  checkApprovable,
};
