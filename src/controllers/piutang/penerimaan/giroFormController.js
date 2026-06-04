const service = require("../../../services/piutang/penerimaan/giroFormService");

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const user = req.user;
    const result = await service.saveData(req.body, user);
    res
      .status(200)
      .json({ success: true, message: "Berhasil disimpan", data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  saveData,
};
