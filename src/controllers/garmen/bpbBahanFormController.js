const bpbBahanFormService = require("../../services/garmen/bpbBahanFormService");

const validateField = async (req, res) => {
  try {
    const { type, value } = req.query;
    const result = await bpbBahanFormService.validateField(type, value);

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await bpbBahanFormService.getDetail(nomor);

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const saveData = async (req, res) => {
  try {
    const payload = req.body;
    const userKode = req.user?.kode || "SYSTEM";

    const result = await bpbBahanFormService.saveData(payload, userKode);

    res.status(200).json({
      success: true,
      message: "Data BPB Bahan berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    console.error("Error Save BPB Bahan:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMaxBarcode = async (req, res) => {
  try {
    const { kode, tahun } = req.query;

    if (!kode || !tahun) {
      return res
        .status(400)
        .json({ success: false, message: "Kode dan Tahun wajib dikirim." });
    }

    const maxVal = await bpbBahanFormService.getMaxBarcode(kode, tahun);

    res.status(200).json({ success: true, data: maxVal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  validateField,
  getDetail,
  saveData,
  getMaxBarcode,
};
