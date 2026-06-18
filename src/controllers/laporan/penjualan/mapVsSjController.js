const service = require("../../../services/laporan/penjualan/mapVsSjService");

const getMasterMap = async (req, res) => {
  try {
    const data = await service.getMasterMap(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetailSj = async (req, res) => {
  try {
    const { mapNomor } = req.params;
    if (!mapNomor) {
      return res
        .status(400)
        .json({ success: false, message: "Nomor MAP wajib dikirim" });
    }

    // Melakukan decode URL karena mapNomor mengandung garis miring (/)
    const decodedNomor = decodeURIComponent(mapNomor);
    const data = await service.getDetailSj(decodedNomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllDetailSj = async (req, res) => {
  try {
    const data = await service.getAllDetailSj(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMasterMap,
  getDetailSj,
  getAllDetailSj,
};
