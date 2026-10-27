const service = require("../../services/ga/perawatanService");

const generateNomor = async (req, res) => {
  try {
    const { tanggal } = req.query;
    const nomor = await service.generateNomor(tanggal);
    res.json({ success: true, data: { nomor } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    if (!tglAwal || !tglAkhir) {
      return res.status(400).json({
        success: false,
        message: "Parameter tglAwal dan tglAkhir wajib diisi.",
      });
    }

    const data = await service.getBrowse({ tglAwal, tglAkhir });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getById(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const searchKendaraan = async (req, res) => {
  try {
    const { q } = req.query;
    const data = await service.searchKendaraan(q || "");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const create = async (req, res) => {
  try {
    const result = await service.create(req.body);
    res.status(201).json({
      success: true,
      message: `Perawatan ${result.nomor} berhasil disimpan.`,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.update(nomor, req.body);
    res.json({
      success: true,
      message: `Perawatan ${result.nomor} berhasil diperbarui.`,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await service.deleteData(nomor);
    res.json({
      success: true,
      message: `Perawatan ${nomor} berhasil dihapus.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  generateNomor,
  getBrowse,
  getDetail,
  getById,
  searchKendaraan,
  create,
  update,
  deleteData,
};
