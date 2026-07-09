const svc = require("../../services/ppic/proofService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, cab } = req.query;
    const today = new Date().toISOString().substring(0, 10);
    const startOfMonth = today.substring(0, 8) + "01";

    // Default cabang filter sesuai cabang user — user pusat (HO-)
    // otomatis ALL, user cabang lain default ke cabangnya sendiri.
    const userCab = req.user?.cabang || "";
    const defaultCab = userCab && userCab !== "HO-" ? userCab : "ALL";

    const data = await svc.getBrowse({
      startDate: startDate || startOfMonth,
      endDate: endDate || today,
      cab: cab || defaultCab,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetailByNomor(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getExportDetail = async (req, res) => {
  try {
    const { startDate, endDate, cab } = req.query;
    const today = new Date().toISOString().substring(0, 10);
    const startOfMonth = today.substring(0, 8) + "01";
    const data = await svc.getDetailBulk({
      startDate: startDate || startOfMonth,
      endDate: endDate || today,
      cab: cab || "ALL",
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const userCab = req.user?.cabang || "";
    await svc.deleteData(req.params.nomor, userCab);
    res.status(200).json({ success: true, message: "Berhasil dihapus." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMeta = async (req, res) => {
  try {
    const userCab = req.user?.cabang || "";
    res.status(200).json({
      success: true,
      data: {
        cabangOptions: svc.CABANG_OPTIONS,
        defaultCab: userCab && userCab !== "HO-" ? userCab : "ALL",
        userCab,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  getExportDetail,
  remove,
  getMeta,
};
