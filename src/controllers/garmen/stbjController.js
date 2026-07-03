const svc = require("../../services/garmen/stbjService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, gudang = "" } = req.query;
    const data = await svc.getBrowse(tglAwal, tglAkhir, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, gudang = "" } = req.query;
    const data = await svc.getBrowseDetail(tglAwal, tglAkhir, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetailByNomor = async (req, res) => {
  try {
    const nomor = req.query.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.getDetailByNomor(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.body;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const userCab = req.user?.cabang || "";
    await svc.deleteData(nomor, userKode, userCab);
    res.json({ success: true, message: "Data berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const pengajuanUbah = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const result = await svc.pengajuanUbah(nomor, alasan, userKode);
    res.json({ success: true, data: result, message: "Pengajuan berhasil." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getExportData = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, gudang = "" } = req.query;
    const data = await svc.getExportData(tglAwal, tglAkhir, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, gudang = "" } = req.query;
    const data = await svc.getExportDetail(tglAwal, tglAkhir, gudang);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getDetailByNomor,
  deleteData,
  pengajuanUbah,
  getExportData,
  getExportDetail,
};
