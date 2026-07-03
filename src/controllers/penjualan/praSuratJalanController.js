const svc = require("../../services/penjualan/praSuratJalanService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getBrowse(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, praSj = "" } = req.query;
    const data = await svc.getBrowseDetail(tglAwal, tglAkhir, praSj);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekBisaUbah = async (req, res) => {
  try {
    const { praSj } = req.query;
    const data = await svc.cekBisaUbah(praSj);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekBisaHapus = async (req, res) => {
  try {
    const { praSj } = req.query;
    const data = await svc.cekBisaHapus(praSj);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { praSj } = req.params;
    await svc.deleteData(praSj);
    res.json({ success: true, message: "Berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getExportData(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getExportDetail(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getListForCreateSj = async (req, res) => {
  try {
    const data = await svc.getListForCreateSj();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const convertToSj = async (req, res) => {
  try {
    const { tanggal, praSjList } = req.body;
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = await svc.convertToSj(tanggal, praSjList, userKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaUbah,
  cekBisaHapus,
  deleteData,
  getExportData,
  getExportDetail,
  getListForCreateSj,
  convertToSj,
};
