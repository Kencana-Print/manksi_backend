const pengajuanDanaService = require("../../services/piutang/pengajuanDanaService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await pengajuanDanaService.getBrowse(
      startDate,
      endDate,
      req.user.kode,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await pengajuanDanaService.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await pengajuanDanaService.deleteData(req.params.nomor);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
};
