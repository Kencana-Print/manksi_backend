const svc = require("../../services/piutang/rekapPembayaranService");

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

const batalData = async (req, res) => {
  try {
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const { nomor } = req.params;
    const { alasan } = req.body;
    await svc.batalData(nomor, alasan, userKode);
    res.json({ success: true, message: "Rekap pembayaran dibatalkan." });
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

module.exports = { getBrowse, getBrowseDetail, batalData, deleteData };
