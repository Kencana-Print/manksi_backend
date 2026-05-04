const returBahanService = require("../../services/garmen/returBahanService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const cabang = req.user.cabang;

    const data = await returBahanService.getBrowseData(
      startDate,
      endDate,
      cabang,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteRetur = async (req, res) => {
  try {
    const { nomor } = req.params;
    const bagianUser = req.user.bagian;

    await returBahanService.deleteData(nomor, bagianUser);
    res.status(200).json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestEdit = async (req, res) => {
  try {
    const payload = req.body; // { nomor, tanggal, keterangan, alasan }
    const user = req.user;

    await returBahanService.ajukanPerubahan(payload, user);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  deleteRetur,
  requestEdit,
};
