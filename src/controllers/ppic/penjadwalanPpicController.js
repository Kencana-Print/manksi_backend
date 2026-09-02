// controllers/ppic/penjadwalanPpicController.js
const penjadwalanPpicService = require("../../services/ppic/penjadwalanPpicService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await penjadwalanPpicService.getBrowse(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await penjadwalanPpicService.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const toggleClose = async (req, res) => {
  try {
    const { isClose } = req.body;
    await penjadwalanPpicService.toggleClose(req.params.nomor, !!isClose);
    res.status(200).json({ success: true, message: "Status berhasil diubah." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await penjadwalanPpicService.deleteData(req.params.nomor);
    res.status(200).json({ success: true, message: "Data berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getDetail, toggleClose, deleteData };
