const customerService = require("../../services/master/customerService");

const getBrowse = async (req, res) => {
  try {
    // parameter filterKorporasi dari query: "Y", "N", atau ""
    const filterKorporasi = req.query.filterKorporasi || "";
    const data = await customerService.getBrowse(filterKorporasi);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await customerService.getById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getJenisUsahaLookup = async (req, res) => {
  try {
    const data = await customerService.getJenisUsahaLookup();
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const kode = await customerService.create(req.body, req.user.kode);
    res
      .status(201)
      .json({ success: true, message: "Customer berhasil disimpan", kode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    await customerService.update(req.params.kode, req.body, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Customer berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await customerService.remove(req.params.kode);
    res
      .status(200)
      .json({ success: true, message: "Customer berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getById,
  getJenisUsahaLookup,
  create,
  update,
  remove,
};
