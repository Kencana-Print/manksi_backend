const service = require("../../services/master/complainCustomerService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowseList(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteComplain = async (req, res) => {
  try {
    await service.deleteComplain(req.params.nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteComplain,
};
