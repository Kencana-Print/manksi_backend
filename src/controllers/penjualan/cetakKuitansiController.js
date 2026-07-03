const svc = require("../../services/penjualan/cetakKuitansiService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await svc.getBrowse(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const searchInvoice = async (req, res) => {
  try {
    const { q = "", page = 1, limit = 50 } = req.query;
    const data = await svc.searchInvoice(q, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.getById(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cetak = async (req, res) => {
  try {
    const { nomor } = req.body;
    const userKode = req.user?.kode || req.user?.user_kode || "";
    const data = await svc.saveAndGetDataCetak(nomor, userKode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  searchInvoice,
  getById,
  cetak,
};
