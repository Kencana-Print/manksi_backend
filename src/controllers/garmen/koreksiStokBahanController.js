const service = require("../../services/garmen/koreksiStokBahanService");

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
    const data = await service.getDetailByNomor(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteKoreksi = async (req, res) => {
  try {
    const data = await service.deleteKoreksi(req.params.nomor);
    res.json({ success: true, data, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    const userKode = req.user.kode;
    const data = await service.requestPin(nomor, alasan, userKode);
    res.json({
      success: true,
      data,
      message: "Berhasil diajukkan. Nunggu ACC",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDataCetak = async (req, res) => {
  try {
    const data = await service.getDataCetak(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  deleteKoreksi,
  requestPin,
  getDataCetak,
};
