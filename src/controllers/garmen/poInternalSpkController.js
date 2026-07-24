const service = require("../../services/garmen/poInternalSpkService");

const getBrowse = async (req, res) => {
  try {
    const userCabang = req.user?.cabang || "";
    const data = await service.getBrowseList(req.query, userCabang);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetailByNomor(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkModifiable = async (req, res) => {
  try {
    const userCabang = req.user?.cabang || "";
    const data = await service.checkModifiable(req.params.nomor, userCabang);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const userCabang = req.user?.cabang || "";
    const data = await service.deleteData(req.params.nomor, userCabang);
    res.json({ success: true, data, message: "Sukses" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  checkModifiable,
  deleteData,
};
