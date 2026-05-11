const service = require("../../services/penjualan/salesOrderFormService");

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor SPK wajib diisi." });

    const data = await service.getDetail(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    // Validasi basic structure payload
    if (!req.body.header)
      return res
        .status(400)
        .json({ success: false, message: "Data header tidak lengkap." });

    const result = await service.saveData(req.body, req.user);
    res.json({
      success: true,
      data: result,
      message: req.body.isEdit
        ? "SPK berhasil diubah."
        : "SPK baru berhasil dibuat.",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const validateField = async (req, res) => {
  try {
    const { type, value, extra } = req.query;
    // service.validateField sudah kita buat di percakapan sebelumnya
    const result = await service.validateField(type, value, extra);
    res.json(result);
  } catch (error) {
    res.status(400).json({ valid: false, message: error.message });
  }
};

const getMemoDetail = async (req, res) => {
  try {
    const data = await service.getMemoDetail(req.query.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getDetail, save, validateField, getMemoDetail };
