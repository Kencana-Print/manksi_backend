const formService = require("../../services/garmen/realisasiBahanFormService");

const getPermintaanInfo = async (req, res) => {
  try {
    const { noMinta } = req.query;
    const { nomor } = req.params; // nomor realisasi (opsional) saat mode edit
    const user = req.user; // <-- TANGKAP DATA USER DARI TOKEN

    // Lempar user ke service
    const data = await formService.getPermintaanInfo(noMinta, nomor, user);

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
const getBarcodeInfo = async (req, res) => {
  try {
    const { barcode } = req.params;
    const data = await formService.getBarcodeInfo(barcode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const loadDataEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await formService.getDetailRealisasi(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const user = req.user;
    const isEdit = req.method === "PUT";

    // Pastikan nomor dikirim via param jika edit
    const payload = { ...req.body };
    if (isEdit) payload.nomor = req.params.nomor;

    const result = await formService.saveData(payload, user, isEdit);
    res
      .status(200)
      .json({ success: true, message: "Berhasil disimpan", data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await formService.getPrintData(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  getPermintaanInfo,
  getBarcodeInfo,
  loadDataEdit,
  saveData,
  getPrintData,
};
