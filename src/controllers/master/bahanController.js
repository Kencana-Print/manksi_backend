const bahanService = require("../../services/master/bahanService");

const getBrowseBahan = async (req, res) => {
  try {
    const data = await bahanService.getBrowseBahan();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBahanById = async (req, res) => {
  try {
    const data = await bahanService.getBahanById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createBahan = async (req, res) => {
  try {
    const kode = await bahanService.createBahan(req.body, req.user.kode);
    res.status(201).json({ success: true, message: "Berhasil simpan", kode });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Gagal simpan: " + error.message });
  }
};

const updateBahan = async (req, res) => {
  try {
    await bahanService.updateBahan(req.params.kode, req.body, req.user.kode);
    res.status(200).json({ success: true, message: "Berhasil update" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteBahan = async (req, res) => {
  try {
    await bahanService.deleteBahan(req.params.kode);
    res.status(200).json({ success: true, message: "Berhasil hapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await bahanService.getLookups(req.params.category);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseBahan,
  getBahanById,
  createBahan,
  updateBahan,
  deleteBahan,
  getLookups,
};
