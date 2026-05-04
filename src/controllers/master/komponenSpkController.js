const komponenSpkService = require("../../services/master/komponenSpkService");

const getBrowse = async (req, res) => {
  try {
    // Ambil parameter dari query string, jika tidak ada, default ke hari ini (atau bulan ini)
    const startDate =
      req.query.startDate || new Date().toISOString().split("T")[0]; // Format YYYY-MM-DD
    const endDate = req.query.endDate || new Date().toISOString().split("T")[0];

    // Ambil user_divisi dari token JWT
    const divisiId = req.user.divisi;

    const data = await komponenSpkService.getBrowse(
      startDate,
      endDate,
      divisiId,
    );
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await komponenSpkService.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getBrowse, getDetail };
