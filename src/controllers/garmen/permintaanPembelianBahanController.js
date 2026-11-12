const service = require("../../services/garmen/permintaanPembelianBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    const data = await service.getBrowse(startDate, endDate, cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getBrowseDetail(nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetailRange = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    const data = await service.getBrowseDetailRange(startDate, endDate, cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await service.getPrintData(req.params.nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const closeData = async (req, res) => {
  try {
    await service.closeData(req.params.nomor, req.body?.alasan, req.user);
    res.json({ success: true, message: "Permintaan berhasil ditutup." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deletePermintaan = async (req, res) => {
  try {
    const { nomor } = req.params;
    await service.deletePermintaan(nomor, req.user);
    res.status(200).json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getBrowseDetail,
  getBrowseDetailRange,
  getPrintData,
  closeData,
  deletePermintaan,
};
