const jenisPembayaranService = require("../../services/master/jenisPembayaranService");

const getAll = async (req, res) => {
  try {
    const data = await jenisPembayaranService.getAll();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveData = async (req, res) => {
  try {
    const result = await jenisPembayaranService.saveData(req.body);
    res.json({
      success: true,
      message: "Data berhasil disimpan.",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await jenisPembayaranService.deleteData(req.params.nama);
    res.json({ success: true, message: "Data berhasil dihapus." });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getAll, saveData, deleteData };
