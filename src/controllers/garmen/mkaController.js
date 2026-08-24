const service = require("../../services/garmen/mkaService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, kodeBarang, filterByTglSpk } = req.query;
    if (!startDate || !endDate)
      return res.status(400).json({
        success: false,
        message: "startDate dan endDate wajib diisi.",
      });
    const data = await service.getBrowseList({
      startDate,
      endDate,
      kodeBarang: kodeBarang || "",
      filterByTglSpk: filterByTglSpk === "true" || filterByTglSpk === true,
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor MKA wajib diisi." });
    const data = await service.getDetail(nomor);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res
        .status(400)
        .json({ success: false, message: "Nomor MKA wajib diisi." });
    await service.deleteData(nomor);
    res.json({ success: true, message: "MKA berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const exportHeader = async (req, res) => {
  try {
    const { startDate, endDate, kodeBarang, filterByTglSpk } = req.query;
    const data = await service.getExportHeader({
      startDate,
      endDate,
      kodeBarang: kodeBarang || "",
      filterByTglSpk: filterByTglSpk === "true" || filterByTglSpk === true,
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const { startDate, endDate, kodeBarang, filterByTglSpk } = req.query;
    const data = await service.getExportDetail({
      startDate,
      endDate,
      kodeBarang: kodeBarang || "",
      filterByTglSpk: filterByTglSpk === "true" || filterByTglSpk === true,
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
  exportHeader,
  exportDetail,
};
