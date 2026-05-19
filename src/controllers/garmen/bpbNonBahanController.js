const bpbNonBahanService = require("../../services/garmen/bpbNonBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, jenis, cabang } = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Parameter startDate dan endDate diperlukan.",
        });
    }

    const data = await bpbNonBahanService.getBrowse(
      startDate,
      endDate,
      jenis,
      cabang,
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
    await bpbNonBahanService.deleteData(nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    await bpbNonBahanService.requestPin(req.body, req.user.kode);
    res
      .status(200)
      .json({
        success: true,
        message: "Pengajuan berhasil dikirim. Menunggu ACC.",
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteData,
  requestPin,
};
