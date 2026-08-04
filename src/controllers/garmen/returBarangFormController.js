const service = require("../../services/garmen/returBarangFormService");

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

const searchRealisasiHeader = async (req, res) => {
  try {
    const { jenis, keyword, page, limit } = req.query;
    if (!jenis) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter jenis wajib diisi." });
    }
    const data = await service.searchRealisasiHeader(
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

const searchRealisasiDetail = async (req, res) => {
  try {
    const { jenis, nomorRealisasi, currentNomor } = req.query;
    if (!jenis || !nomorRealisasi) {
      return res.status(400).json({
        success: false,
        message: "Parameter jenis dan nomorRealisasi wajib diisi.",
      });
    }
    const data = await service.searchRealisasiDetail(
      jenis,
      nomorRealisasi,
      currentNomor,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const searchBarang = async (req, res) => {
  try {
    const { jenis, keyword, page, limit } = req.query;
    if (!jenis) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter jenis wajib diisi." });
    }
    const data = await service.searchBarang(
      jenis,
      req.user.cabang,
      req.user.bagian,
      keyword,
      Number(page) || 1,
      Number(limit) || 50,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFormData,
  create,
  update,
  searchRealisasiHeader,
  searchRealisasiDetail,
  searchBarang,
};
