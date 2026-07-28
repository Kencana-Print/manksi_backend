const service = require("../../services/garmen/sjPoInternalSpkService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowseList(req.query);
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

const checkModifiable = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.checkModifiable(
      decodeURIComponent(nomor),
      req.user.cabang,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.deleteData(
      decodeURIComponent(nomor),
      req.user.cabang,
    );
    res.json({ success: true, message: "Sukses", data });
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
