const service = require("../../services/garmen/koreksiStokBarangFormService");

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

const resolveKode = async (req, res) => {
  try {
    const { jenis, kode, cabang, tanggal, currentNomor } = req.query;
    if (!jenis || !kode || !cabang || !tanggal) {
      return res.status(400).json({
        success: false,
        message: "Parameter jenis, kode, cabang, dan tanggal wajib diisi.",
      });
    }
    const data = await service.resolveKode(
      jenis,
      kode,
      cabang,
      tanggal,
      currentNomor || "",
      req.user.bagian,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchBarang = async (req, res) => {
  try {
    const { jenis, cabang, keyword, page, limit } = req.query;
    if (!jenis || !cabang) {
      return res.status(400).json({
        success: false,
        message: "Parameter jenis dan cabang wajib diisi.",
      });
    }
    const data = await service.searchBarang(
      jenis,
      cabang,
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
  resolveKode,
  searchBarang,
  getDataCetak,
};
