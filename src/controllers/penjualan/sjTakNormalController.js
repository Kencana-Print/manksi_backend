const svc = require("../../services/penjualan/sjTakNormalService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBrowse(tglAwal, tglAkhir, canLihatCus);
    res.json({ success: true, data, canLihatCus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, nomor = "" } = req.query;
    const data = await svc.getBrowseDetail(tglAwal, tglAkhir, nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cekBisaUbah = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekBisaUbah(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekBisaHapus = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekBisaHapus(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cekBisaCetak = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.cekBisaCetak(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await svc.deleteData(nomor);
    res.json({ success: true, message: "Berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getExportData(tglAwal, tglAkhir, canLihatCus);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getExportDetail(tglAwal, tglAkhir, canLihatCus);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  cekBisaUbah,
  cekBisaHapus,
  cekBisaCetak,
  deleteData,
  getExportData,
  getExportDetail,
};
