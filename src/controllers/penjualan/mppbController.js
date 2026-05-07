const mppbService = require("../../services/penjualan/mppbService");

const getBrowseList = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Filter startDate dan endDate wajib diisi.",
        });
    }
    const data = await mppbService.getBrowseList(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    await mppbService.deleteData(nomor);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const toggleApprove = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { currentStatus } = req.body;

    if (typeof currentStatus === "undefined") {
      return res
        .status(400)
        .json({ success: false, message: "currentStatus wajib dikirimkan." });
    }

    const newStatus = await mppbService.toggleApprove(nomor, currentStatus);
    const msg =
      newStatus === "Y" ? "Berhasil di-Approve." : "Approve telah dibatalkan.";

    res.status(200).json({ success: true, message: msg, newStatus });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin5 = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    if (!nomor || !alasan) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Nomor dan alasan pengajuan wajib diisi.",
        });
    }
    await mppbService.requestPin5(nomor, alasan, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  deleteData,
  toggleApprove,
  requestPin5,
};
