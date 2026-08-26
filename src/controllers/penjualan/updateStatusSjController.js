const svc = require("../../services/penjualan/updateStatusSjService");

// ── Browse ───────────────────────────────────────────────
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

// ── Form ─────────────────────────────────────────────────
const getStatusList = async (req, res) => {
  try {
    const data = await svc.getStatusList();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getFormById = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor wajib diisi." });
    }
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getFormById(nomor, canLihatCus);
    res.json({ success: true, data, canLihatCus });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const saveStatus = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await svc.saveStatus(nomor, req.body);
    res.json({ success: true, data: result, message: "Berhasil di Update." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getExportData,
  getExportDetail,
  getStatusList,
  getFormById,
  saveStatus,
};
