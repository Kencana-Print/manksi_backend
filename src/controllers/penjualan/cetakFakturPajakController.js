const svc = require("../../services/penjualan/cetakFakturPajakService");

const checkNomor = async (req, res) => {
  try {
    const { nomor } = req.query;
    const data = await svc.checkNomor(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const saveAndGetDataCetak = async (req, res) => {
  try {
    const { nomor, noSeri } = req.body;
    const data = await svc.saveAndGetDataCetak(nomor, noSeri);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const { nomor, noSeri = "" } = req.query;
    const data = await svc.getDataCetak(nomor, noSeri);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
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

module.exports = {
  checkNomor,
  saveAndGetDataCetak,
  getDataCetak,
  searchInvoice,
};
