const service = require("../../services/garmen/returPembelianFormService");

const getFormData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getFormData(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const nomor = await service.saveData(req.body, req.user);
    res
      .status(201)
      .json({ success: true, data: { nomor }, message: "Berhasil disimpan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.saveData(req.body, req.user, nomor);
    res.status(200).json({
      success: true,
      data: { nomor: result },
      message: "Berhasil disimpan.",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchBpb = async (req, res) => {
  try {
    const { jenis, keyword, page, limit } = req.query;
    if (!jenis) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter jenis wajib diisi." });
    }
    const data = await service.searchBpb(
      jenis,
      keyword,
      Number(page) || 1,
      Number(limit) || 50,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const resolveBpb = async (req, res) => {
  try {
    const { jenis, bpbNomor } = req.query;
    if (!jenis || !bpbNomor) {
      return res.status(400).json({
        success: false,
        message: "Parameter jenis dan bpbNomor wajib diisi.",
      });
    }
    const data = await service.resolveBpb(bpbNomor, jenis);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataCetak(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormData,
  create,
  update,
  searchBpb,
  resolveBpb,
  getDataCetak,
};
