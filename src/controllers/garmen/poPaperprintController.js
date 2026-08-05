const poPaperprintService = require("../../services/garmen/poPaperprintService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, spk } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }

    const data = await poPaperprintService.getBrowseData(
      startDate,
      endDate,
      spk || "",
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await poPaperprintService.deleteData(nomor);
    res.status(200).json({ success: true, message: "Sukses" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poPaperprintService.getPrintData(nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteData,
  getPrintData,
};
