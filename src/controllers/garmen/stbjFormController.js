const svc = require("../../services/garmen/stbjFormService");

const getById = async (req, res) => {
  try {
    const nomor = req.query.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.getById(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSpkDetail = async (req, res) => {
  try {
    const { spkNomor, gudangKode, excludeNomor = "" } = req.query;
    const data = await svc.getSpkDetail(spkNomor, gudangKode, excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSpgDetail = async (req, res) => {
  try {
    const { spgNomor, excludeNomor = "" } = req.query;
    const data = await svc.getSpgDetail(spgNomor, excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getPackingAvailable = async (req, res) => {
  try {
    const data = await svc.getPackingAvailable();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPackingDetail = async (req, res) => {
  try {
    const { packNomor, excludeNomor = "" } = req.query;
    const data = await svc.getPackingDetail(packNomor, excludeNomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const save = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const nomor = await svc.save(req.body, userKode, true);
    res.json({ success: true, data: { nomor }, message: "Berhasil disimpan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const update = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const nomor = await svc.save(req.body, userKode, false);
    res.json({ success: true, data: { nomor }, message: "Berhasil diupdate." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const nomor = req.query.nomor;
    const data = await svc.getDataCetak(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getById,
  getSpkDetail,
  getSpgDetail,
  getPackingAvailable,
  getPackingDetail,
  save,
  update,
  getDataCetak,
};
