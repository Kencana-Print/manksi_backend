const service = require("../../../services/laporan/piutang/rekapPiutangService");

const getRekapPiutang = async (req, res) => {
  try {
    const data = await service.getRekapPiutang(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getRekapPiutang,
};
