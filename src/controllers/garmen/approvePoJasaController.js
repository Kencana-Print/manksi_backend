const svc = require("../../services/garmen/approvePoJasaService");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    if (!tglAwal || !tglAkhir)
      return res
        .status(400)
        .json({ success: false, message: "tglAwal dan tglAkhir wajib." });
    const data = await svc.getBrowse(tglAwal, tglAkhir);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const nomor = req.params.nomor || req.query.nomor;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.getDetail(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const toggleApprove = async (req, res) => {
  try {
    const { nomor } = req.body;
    if (!nomor)
      return res.status(400).json({ success: false, message: "Nomor wajib." });
    const data = await svc.toggleApprove(nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, getDetail, toggleApprove };
