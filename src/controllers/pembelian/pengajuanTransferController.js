const svc = require("../../services/pembelian/pengajuanTransferService");

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

const getStatus = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await svc.getStatus(nomor);
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
  getStatus,
  getBrowsePendingAll,
  getBrowseDetailPendingAll,
};
