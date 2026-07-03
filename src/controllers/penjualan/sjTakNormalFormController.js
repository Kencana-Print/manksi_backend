const svc = require("../../services/penjualan/sjTakNormalFormService");

const checkNomor = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.checkNomor(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const loadBarangDetail = async (req, res) => {
  try {
    const { kode, divisi } = req.query;
    const data = await svc.loadBarangDetail(kode, divisi);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSpkCustomer = async (req, res) => {
  try {
    const { kode } = req.query;
    const data = await svc.getSpkCustomer(kode);
    res.json({ success: true, data: { cusKode: data } });
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

const searchPerusahaan = async (req, res) => {
  try {
    const { q = "" } = req.query;
    const data = await svc.searchPerusahaan(q);
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

const searchBarang = async (req, res) => {
  try {
    const {
      invPro = "",
      cusKode = "",
      divisi,
      q = "",
      page = 1,
      limit = 50,
    } = req.query;
    const data = invPro
      ? await svc.searchBarangByInvPro(invPro, cusKode, divisi, q, page, limit)
      : await svc.searchBarangByDivisi(divisi, q, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
  checkNomor,
  loadBarangDetail,
  getSpkCustomer,
  getCustomerInfo,
  searchPerusahaan,
  getDivisiList,
  searchBarang,
  getDataCetak,
  save,
  update,
};
