const service = require("../../services/ga/ambilVoucherService");

const getMaxKode = async (req, res) => {
  try {
    const data = await service.getMaxKode();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getLookups = async (req, res) => {
  try {
    const data = await service.getLookups();
    res.json({ success: true, data });
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

const getById = async (req, res) => {
  try {
    const { kode, id } = req.params;
    const data = await service.getById(kode, id);
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
      message: `Ambil Voucher nomor ${result.no_voucher} berhasil disimpan.`,
      data: result,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const { kode, id } = req.params;
    const result = await service.update(kode, id, req.body);
    res.json({
      success: true,
      message: `Ambil Voucher nomor ${result.no_voucher} berhasil diperbarui.`,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const remove = async (req, res) => {
  try {
    const { kode, id } = req.params;
    await service.deleteData(kode, id);
    res.json({
      success: true,
      message: `Ambil Voucher nomor ${kode} berhasil dihapus.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getMaxKode,
  getLookups,
  getBrowse,
  getById,
  create,
  update,
  remove,
};
