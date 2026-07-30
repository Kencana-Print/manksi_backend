const svc = require("../../../services/laporan/marketing/realisasiPengirimanSpkService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, divisi = 0 } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Periode tanggal wajib diisi." });
    }
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await svc.getBrowse(startDate, endDate, divisi, canLihatCus);
    res.json({ success: true, data, canLihatCus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateReason = async (req, res) => {
  try {
    const { spkNomor, reason } = req.body;
    const data = await svc.updateReason(spkNomor, reason);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getBrowse, updateReason };
