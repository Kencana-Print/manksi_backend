const penawaranService = require("../../services/penjualan/penawaranService");

const getBrowseList = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const user = req.user;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Parameter startDate dan endDate wajib diisi.",
      });
    }

    const canLihatCus = Number(user.flags?.lihatCus) === 1;
    const data = await penawaranService.getPenawaranList(
      startDate,
      endDate,
      status || "ALL",
      user,
    );

    res.status(200).json({ success: true, data, canLihatCus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBrowseDetail = async (req, res) => {
  try {
    const { nomor } = req.params;
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const data = await penawaranService.getPenawaranDetail(nomor, canLihatCus);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    if (!canLihatCus) {
      return res.status(403).json({
        success: false,
        message: "Anda tidak berhak menghapus di modul ini.",
      });
    }
    const { nomor } = req.params;
    const success = await penawaranService.deletePenawaran(nomor);
    if (success) {
      res
        .status(200)
        .json({ success: true, message: "Data berhasil dihapus." });
    } else {
      res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    if (!canLihatCus) {
      return res
        .status(403)
        .json({ success: false, message: "Anda tidak berhak buka modul ini." });
    }
    const { nomor } = req.params;
    const { details } = req.body;
    await penawaranService.updateStatusDetail(nomor, details);
    res
      .status(200)
      .json({ success: true, message: "Status berhasil diupdate." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  getBrowseDetail,
  deleteData,
  updateStatus,
};
