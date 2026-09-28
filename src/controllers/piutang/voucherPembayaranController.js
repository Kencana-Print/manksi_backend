const svc = require("../../services/piutang/voucherPembayaranService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await svc.getBrowse(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await svc.getBrowseDetail(startDate, endDate);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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

const cekPengajuan = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.cekPengajuan(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const requestPin5 = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const { nomor } = req.params;
    const { alasan } = req.body;
    await svc.requestPin5(nomor, alasan, userKode);
    res.json({ success: true, message: "Pengajuan berhasil diajukan." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.getPrintData(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getBrowsePendingAll = async (req, res) => {
  try {
    const data = await svc.getBrowsePendingAll();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBrowseDetailPendingAll = async (req, res) => {
  try {
    const data = await svc.getBrowseDetailPendingAll();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  deleteData,
  cekPengajuan,
  requestPin5,
  getPrintData,
  getBrowsePendingAll,
  getBrowseDetailPendingAll,
};
