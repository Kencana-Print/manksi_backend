const svc = require("../../services/penjualan/invoiceTakNormalFormService");

const getById = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.getById(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchBarang = async (req, res) => {
  try {
    const { cusKode = "", q = "" } = req.query;
    const data = await svc.searchBarang(cusKode, q);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const loadBarangDetail = async (req, res) => {
  try {
    const { kode } = req.query;
    const data = await svc.loadBarangDetail(kode);
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

const getRekeningPerush = async (req, res) => {
  try {
    const { perushKode } = req.query;
    const data = await svc.getRekeningPerush(perushKode);
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

const getInvoiceNormalList = async (req, res) => {
  try {
    const { divisiGroup, q = "", page = 1, limit = 50 } = req.query;
    const data = await svc.getInvoiceNormalList(divisiGroup, q, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const validateInvoiceNormal = async (req, res) => {
  try {
    const { nomor, currentNomor = "" } = req.query;
    const data = await svc.validateInvoiceNormal(nomor, currentNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
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

const getDataCetak = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.getDataCetak(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getById,
  searchBarang,
  loadBarangDetail,
  searchPerusahaan,
  getCustomerInfo,
  getRekeningPerush,
  getDivisiList,
  getInvoiceNormalList,
  validateInvoiceNormal,
  save,
  update,
  getDataCetak,
};
