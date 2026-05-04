const sjService = require("../../services/garmen/poInternalMapSjService");

const getBrowseList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      nomorMap: req.query.nomorMap,
    };
    const userCabang = req.user?.cabang || "ALL";
    const data = await sjService.getBrowseList(filters, userCabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSjDetail = async (req, res) => {
  try {
    const data = await sjService.getSjDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      nomorMap: req.query.nomorMap,
    };
    const data = await sjService.getExportDetail(filters);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteSj = async (req, res) => {
  try {
    const userCabang = req.user?.cabang;
    await sjService.deleteSj(req.params.nomor, userCabang);
    res
      .status(200)
      .json({ success: true, message: "Surat Jalan berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestPin5 = async (req, res) => {
  try {
    const { alasan } = req.body;
    if (!alasan || alasan.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Alasan pengajuan harus diisi." });
    }

    const userKode = req.user?.kode || "ADMIN";
    await sjService.requestPin5(req.params.nomor, alasan, userKode);

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
  getBrowseList,
  getSjDetail,
  getExportDetail,
  deleteSj,
  requestPin5,
};
