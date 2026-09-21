const uangMukaService = require("../../services/pembelian/uangMukaService");

const getOutstanding = async (req, res) => {
  try {
    const { search = "", startDate, endDate, page = 1, limit = 25 } = req.query;
    const result = await uangMukaService.getOutstanding({
      search,
      startDate,
      endDate,
      page: Number(page),
      limit: Number(limit),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getOutstandingDetail = async (req, res) => {
  try {
    const { sumber, nomor } = req.query;
    const rows = await uangMukaService.getOutstandingDetail(sumber, nomor);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    const rows = await uangMukaService.getHistory({
      startDate,
      endDate,
      cabang,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteHistory = async (req, res) => {
  try {
    await uangMukaService.deleteHistory(req.params.nomor);
    res.json({ message: "Data berhasil dihapus." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getOutstanding,
  getOutstandingDetail,
  getHistory,
  deleteHistory,
};
