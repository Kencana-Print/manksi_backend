const svc = require("../../services/pembelian/inputFakturVoucherService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const data = await svc.getBrowse(startDate, endDate, status);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const simpanFaktur = async (req, res) => {
  try {
    const { nomor, nomorPajak } = req.body;
    const data = await svc.simpanFaktur(nomor, nomorPajak, req.user?.kode);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, simpanFaktur };
