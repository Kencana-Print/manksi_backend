const poBahanFormService = require("../../services/pembelian/poBahanFormService");

const validateField = async (req, res) => {
  try {
    const { type, value } = req.query;
    const data = await poBahanFormService.validateField(type, value);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await poBahanFormService.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    const result = await poBahanFormService.saveData(req.body, userKode);
    res.status(200).json({
      success: true,
      message: "PO Bahan berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMkbDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await poBahanFormService.getDetailMkbForPo(nomor);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error getMkbDetail:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Terjadi kesalahan saat memuat detail MKB",
    });
  }
};

const getSupplierByKode = async (req, res) => {
  try {
    const data = await poBahanFormService.getSupplierByKode(req.params.kode);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  validateField,
  getDetail,
  save,
  getMkbDetail,
  getSupplierByKode,
};
