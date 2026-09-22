const svc = require("../../services/pembelian/uangMukaRealisasiService");
const { getPrint } = require("../garmen/realisasiBarangFormController");

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

const getPrintData = async (req, res) => {
  try {
    const data = await svc.getPrintData(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAccountOptions,
  getSupplierOptions,
  getPumOptions,
  getDetail,
  saveRealisasi,
  getPrintData,
};
