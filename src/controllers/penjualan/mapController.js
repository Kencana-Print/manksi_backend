const mapService = require("../../services/penjualan/mapService");

const getBrowseList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.user.cabang,
      isKaosan: req.user.cabKaos,
    };

    const canLihatCus = Number(req.user?.flags?.lihatCus) === 1;
    const canLihatHarga = Number(req.user?.flags?.lihatHarga) === 1;

    const data = await mapService.getBrowseList(
      filters,
      canLihatCus,
      canLihatHarga,
    );
    res.status(200).json({ success: true, data, canLihatCus, canLihatHarga });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteMap = async (req, res) => {
  try {
    const { nomor } = req.params;
    await mapService.deleteMap(nomor, req.user);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const toggleClose = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { isClose } = req.body; // 'Y' atau 'N'

    await mapService.toggleClose(nomor, isClose);
    res.status(200).json({
      success: true,
      message: `Berhasil di-${isClose === "Y" ? "Close" : "Open"}.`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const approveCmo = async (req, res) => {
  try {
    const { nomor } = req.params;

    // FIX: sebelumnya cek req.user.isCmo (gak pernah ada di payload JWT).
    // Field yang benar: req.user.flags.cmo (dari kolom user_cmo, tipe int 1/0).
    if (req.user.flags?.cmo !== 1) {
      return res
        .status(403)
        .json({ success: false, message: "Anda tidak memiliki hak CMO." });
    }

    await mapService.approveCmo(nomor, req.user.kode);
    res.status(200).json({ success: true, message: "Berhasil di-approve." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const requestPin5 = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { alasan } = req.body;

    if (!alasan || alasan.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Alasan harus diisi." });
    }

    await mapService.requestPin5(nomor, alasan, req.user.kode);
    res
      .status(200)
      .json({ success: true, message: "Berhasil diajukan. Menunggu ACC." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDesignList = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate dan endDate wajib diisi.",
      });
    }
    const data = await mapService.getDesignList(startDate, endDate);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateDesignStatus = async (req, res) => {
  try {
    const { rows } = req.body;
    await mapService.updateDesignStatus(rows);
    res
      .status(200)
      .json({ success: true, message: "Update status design berhasil." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  deleteMap,
  toggleClose,
  approveCmo,
  requestPin5,
  getDesignList,
  updateDesignStatus,
};
