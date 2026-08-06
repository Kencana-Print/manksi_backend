const poDtfService = require("../../services/garmen/poDtfService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cabang, spk } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }

    const data = await poDtfService.getBrowseData(
      startDate,
      endDate,
      cabang || "ALL",
      spk || "",
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await poDtfService.deleteData(nomor, req.user);
    res.status(200).json({ success: true, message: "Sukses" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await poDtfService.getPrintData(nomor);
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
