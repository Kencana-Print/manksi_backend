const svc = require("../../services/penjualan/invoiceFormService");

const getById = async (req, res) => {
  try {
    const data = await svc.getById(req.query.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekStatusPelunasan = async (req, res) => {
  try {
    const sudahLunas = await svc.cekStatusPelunasan(req.query.nomor);
    res.json({ success: true, data: { sudahLunas } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const searchBarang = async (req, res) => {
  try {
    const { perushKode, cusKode, q = "", page = 1, limit = 50 } = req.query;
    if (!perushKode || !cusKode) {
      return res.status(400).json({
        success: false,
        message: "Perusahaan dan Customer wajib diisi.",
      });
    }
    const data = await svc.searchBarang(perushKode, cusKode, q, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const loadBarangDetail = async (req, res) => {
  try {
    const { kode, perushKode } = req.query;
    const data = await svc.loadBarangDetail(kode, perushKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.save(req.body, userKode, true);
    res.json({ success: true, data: result, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.save(req.body, userKode, false);
    res.json({ success: true, data: result, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
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

const getCustomerInfo = async (req, res) => {
  try {
    const data = await svc.getCustomerInfo(req.query.kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const validateInvPro = async (req, res) => {
  try {
    const { nomorPro, cusKode } = req.query;
    const data = await svc.validateInvPro(nomorPro, cusKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getRekeningPerush = async (req, res) => {
  try {
    const data = await svc.getRekeningPerush(req.query.perushKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const data = await svc.getDataCetak(req.query.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getById,
  cekStatusPelunasan,
  searchBarang,
  loadBarangDetail,
  save,
  update,
  getDivisiList,
  getCustomerInfo,
  validateInvPro,
  getRekeningPerush,
  getDataCetak,
};
