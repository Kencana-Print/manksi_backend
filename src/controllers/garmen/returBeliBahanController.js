const service = require("../../services/garmen/returBeliBahanService");

// Helper — replikasi kondisi `zLihatBeli<>0` (flag global Delphi),
// dibaca dari JWT payload (kolom user_lihat_beli di tuser).
const canLihatBeli = (req) => req.user?.flags?.lihatBeli === 1;

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowseList(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetailByNomor(
      req.params.nomor,
      canLihatBeli(req),
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteRetur = async (req, res) => {
  try {
    const data = await service.deleteRetur(req.params.nomor);
    res.json({ success: true, data, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const data = await service.getDataCetak(
      req.params.nomor,
      canLihatBeli(req),
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  deleteRetur,
  getDataCetak,
};
