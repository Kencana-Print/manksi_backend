const poInternalMapService = require("../../services/garmen/poInternalMapService");

const getBrowseList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      nomorMap: req.query.nomorMap,
    };
    const userCabang = req.user?.cabang || "ALL";
    const data = await poInternalMapService.getBrowseList(filters, userCabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Fungsi baru: Get Detail by Nomor PO
const getPoDetail = async (req, res) => {
  try {
    const data = await poInternalMapService.getPoDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deletePo = async (req, res) => {
  try {
    const userCabang = req.user?.cabang;
    await poInternalMapService.deletePo(req.params.nomor, userCabang);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      nomorMap: req.query.nomorMap,
    };
    const data = await poInternalMapService.getExportDetail(filters);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowseList, getPoDetail, deletePo, getExportDetail };
