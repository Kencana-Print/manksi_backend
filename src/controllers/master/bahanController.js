const bahanService = require("../../services/master/bahanService");

const kirimError = (res, error, awalan = "") => {
  res
    .status(error.status || 500)
    .json({ success: false, message: awalan + error.message });
};

const getBrowseBahan = async (req, res) => {
  try {
    const data = await bahanService.getBrowseBahan(req.user.cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getBahanById = async (req, res) => {
  try {
    const data = await bahanService.getBahanById(
      req.params.kode,
      req.user.cabang,
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const createBahan = async (req, res) => {
  try {
    const kode = await bahanService.createBahan(
      req.body,
      req.user.kode,
      req.user.cabang,
    );
    res.status(201).json({ success: true, message: "Berhasil simpan", kode });
  } catch (error) {
    kirimError(res, error, "Gagal simpan: ");
  }
};

const updateBahan = async (req, res) => {
  try {
    await bahanService.updateBahan(
      req.params.kode,
      req.body,
      req.user.kode,
      req.user.cabang,
    );
    res.status(200).json({ success: true, message: "Berhasil update" });
  } catch (error) {
    kirimError(res, error);
  }
};

const deleteBahan = async (req, res) => {
  try {
    await bahanService.deleteBahan(req.params.kode, req.user.cabang);
    res.status(200).json({ success: true, message: "Berhasil hapus" });
  } catch (error) {
    kirimError(res, error);
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await bahanService.getLookups(
      req.params.category,
      req.user.cabang,
      req.query.tipe,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
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
