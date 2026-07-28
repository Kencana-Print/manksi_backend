const service = require("../../services/garmen/inputPlanningSpkFormService");

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const userKode = req.user?.kode || "";
    const { nomor, rows } = req.body;
    const data = await service.saveData(nomor, rows, userKode);
    res.json({ success: true, data, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  saveData,
};
