const approveService = require("../../services/garmen/poInternalMapApproveService");

const getBrowseList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      showNotApprovedOnly: req.query.notApproved === "true",
    };
    const userCabang = req.user?.cabang || "ALL";
    const data = await approveService.getBrowseList(filters, userCabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSjDetail = async (req, res) => {
  try {
    const data = await approveService.getSjDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveSj = async (req, res) => {
  try {
    const userKode = req.user?.kode || "ADMIN";
    await approveService.approveSj(req.params.nomor, userKode);
    res
      .status(200)
      .json({ success: true, message: "Surat Jalan berhasil disetujui." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      showNotApprovedOnly: req.query.notApproved === "true",
    };
    const userCabang = req.user?.cabang || "ALL";
    const data = await approveService.getExportDetail(filters, userCabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowseList,
  getSjDetail,
  approveSj,
  getExportDetail,
};
