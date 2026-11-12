const service = require("../../services/garmen/permintaanPembelianBahanFormService");

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const create = async (req, res) => {
  try {
    const data = await service.create(req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Permintaan pembelian bahan berhasil disimpan",
      data,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req, res) => {
  try {
    const data = await service.update(req.params.nomor, req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Permintaan pembelian bahan berhasil diubah",
      data,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getForEdit, create, update };
