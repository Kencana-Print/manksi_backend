const poNonBahanService = require("../../services/garmen/poNonBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, jenis, cabang } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate diperlukan.",
      });
    }

    const data = await poNonBahanService.getBrowse(
      startDate,
      endDate,
      jenis,
      cabang,
      req.user,
    );
    res.status(200).json({
      success: true,
      data,
      canLihatSup: Number(req.user?.flags?.lihatSup) === 1,
      canLihatBeli: Number(req.user?.flags?.lihatBeli) === 1,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await poNonBahanService.deleteData(nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin = async (req, res) => {
  try {
    await poNonBahanService.requestPin(req.body, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Pengajuan berhasil dikirim." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteData,
  requestPin,
};
