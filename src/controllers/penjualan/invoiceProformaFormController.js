const formService = require("../../services/penjualan/invoiceProformaFormService");

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await formService.getDetailForm(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getUangMuka = async (req, res) => {
  try {
    const { nomor } = req.params;
    const uangMuka = await formService.getUangMuka(nomor);
    res.status(200).json({ success: true, data: uangMuka });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await formService.saveData(req.body, req.user);
    res
      .status(200)
      .json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDetail,
  getUangMuka,
  saveData,
};
