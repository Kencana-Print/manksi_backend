const jenisBahanService = require("../../services/master/jenisBahanService");

const getBrowse = async (req, res) => {
  try {
    const data = await jenisBahanService.getBrowse();
    res.status(200).json({
      success: true,
      message: "Berhasil mengambil daftar jenis bahan",
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data: " + error.message,
    });
  }
};

const getById = async (req, res) => {
  try {
    const data = await jenisBahanService.getById(req.params.kode);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Data jenis bahan tidak ditemukan",
      });
    }
    res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const create = async (req, res) => {
  try {
    await jenisBahanService.create(req.body);
    res.status(201).json({
      success: true,
      message: "Jenis bahan baru berhasil disimpan",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal menyimpan data: " + error.message,
    });
  }
};

const update = async (req, res) => {
  try {
    await jenisBahanService.update(req.params.kode, req.body);
    res.status(200).json({
      success: true,
      message: "Data jenis bahan berhasil diperbarui",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal memperbarui data: " + error.message,
    });
  }
};

const remove = async (req, res) => {
  try {
    await jenisBahanService.remove(req.params.kode);
    res.status(200).json({
      success: true,
      message: "Jenis bahan berhasil dihapus",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Gagal menghapus data: " + error.message,
    });
  }
};

module.exports = {
  getBrowse,
  getById,
  create,
  update,
  remove,
};
