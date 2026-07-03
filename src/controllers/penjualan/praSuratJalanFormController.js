const svc = require("../../services/penjualan/praSuratJalanFormService");

const getById = async (req, res) => {
  try {
    const { praSj } = req.query;
    const data = await svc.getById(praSj);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDetailSo = async (req, res) => {
  try {
    const {
      soNomor,
      cusKode,
      divisi,
      currentPraSj = "",
      existingRows = [],
    } = req.body;
    const data = await svc.getDetailSo(
      soNomor,
      cusKode,
      divisi,
      currentPraSj,
      existingRows,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchPerusahaan = async (req, res) => {
  try {
    const { q = "" } = req.query;
    const data = await svc.searchPerusahaan(q);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getCustomerInfo = async (req, res) => {
  try {
    const { kode } = req.query;
    const data = await svc.getCustomerInfo(kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getAlokasiHistory = async (req, res) => {
  try {
    const { cusKode } = req.query;
    const data = await svc.getAlokasiHistory(cusKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDivisiList = async (req, res) => {
  try {
    const data = await svc.getDivisiList();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = await svc.save(req.body, userKode, true);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = await svc.save(req.body, userKode, false);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getById,
  getDetailSo,
  searchPerusahaan,
  getCustomerInfo,
  getAlokasiHistory,
  getDivisiList,
  save,
  update,
};
