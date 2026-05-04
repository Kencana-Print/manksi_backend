const garmenBrgService = require("../../services/master/garmenBrgService");

const getBrowse = async (req, res) => {
  try {
    const { jenis, cabang } = req.query;
    const bagian = req.user?.bagian || "";
    const selectedCabang = cabang || req.user?.cabang || "HO-";

    const data = await garmenBrgService.getBrowse(
      jenis,
      selectedCabang,
      bagian,
    );
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const data = await garmenBrgService.getById(req.params.kode);
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const kode = await garmenBrgService.create(req.body, req.user.kode);
    res
      .status(201)
      .json({ success: true, message: "Barang berhasil disimpan", kode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    await garmenBrgService.update(req.params.kode, req.body, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Barang berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await garmenBrgService.remove(req.params.kode);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await garmenBrgService.getLookups(req.params.category);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getById, create, update, remove, getLookups };
