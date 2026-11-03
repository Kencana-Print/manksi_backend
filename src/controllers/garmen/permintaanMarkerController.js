const svc = require("../../services/garmen/permintaanMarkerService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const today = new Date().toISOString().substring(0, 10);
    const data = await svc.getBrowse({
      startDate: startDate || today,
      endDate: endDate || today,
      status: status || "",
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const today = new Date().toISOString().substring(0, 10);
    const data = await svc.getDetail({
      startDate: startDate || today,
      endDate: endDate || today,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await svc.deleteData(req.params.nomor);
    res
      .status(200)
      .json({ success: true, message: "Permintaan Marker dihapus." });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
};
