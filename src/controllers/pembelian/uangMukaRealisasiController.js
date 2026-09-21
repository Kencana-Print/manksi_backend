const svc = require("../../services/pembelian/uangMukaRealisasiService");

const getAccountOptions = async (req, res) => {
  try {
    const { jenis, cabang } = req.query;
    res.json(await svc.getAccountOptions(jenis, cabang));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getSupplierOptions = async (req, res) => {
  try {
    res.json(await svc.getSupplierOptions(req.query.search));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getPumOptions = async (req, res) => {
  try {
    res.json(await svc.getPumOptions(req.query.cabang));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    res.json(await svc.getDetailForRealisasi(req.params.nomor));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const saveRealisasi = async (req, res) => {
  try {
    const result = await svc.saveRealisasi(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getAccountOptions,
  getSupplierOptions,
  getPumOptions,
  getDetail,
  saveRealisasi,
};
