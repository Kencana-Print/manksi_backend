const poNonBahanFormService = require("../../services/garmen/poNonBahanFormService");

const getDetailForm = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poNonBahanFormService.getDetailForm(nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const getPermintaanDetail = async (req, res) => {
  try {
    const { mbNomor } = req.params;
    const { poNomor } = req.query;
    const data = await poNonBahanFormService.getPermintaanDetail(
      mbNomor,
      poNomor,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const data = await poNonBahanFormService.saveData(req.body, req.user);
    res.status(200).json({ success: true, message: "Berhasil disimpan", data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getDetailForm, getPermintaanDetail, saveData };
