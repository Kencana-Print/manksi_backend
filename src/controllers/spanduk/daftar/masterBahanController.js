const masterBahanService = require("../../../services/spanduk/daftar/masterBahanService");

const getBrowseMasterBahan = async (req, res) => {
  try {
    const data = await masterBahanService.getBrowseMasterBahan();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMasterBahanById = async (req, res) => {
  try {
    const data = await masterBahanService.getMasterBahanById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createMasterBahan = async (req, res) => {
  try {
    const kode = await masterBahanService.createMasterBahan(
      req.body,
      req.user.kode,
    );
    res.status(201).json({ success: true, message: "Berhasil simpan", kode });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Gagal simpan: " + error.message });
  }
};

const updateMasterBahan = async (req, res) => {
  try {
    await masterBahanService.updateMasterBahan(
      req.params.kode,
      req.body,
      req.user.kode,
    );
    res.status(200).json({ success: true, message: "Berhasil update" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteMasterBahan = async (req, res) => {
  try {
    await masterBahanService.deleteMasterBahan(req.params.kode);
    res.status(200).json({ success: true, message: "Berhasil hapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await masterBahanService.getLookups(
      req.params.category,
      req.query.search,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseMasterBahan,
  getMasterBahanById,
  createMasterBahan,
  updateMasterBahan,
  deleteMasterBahan,
  getLookups,
};
