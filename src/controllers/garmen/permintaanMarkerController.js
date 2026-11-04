const svc = require("../../services/garmen/permintaanMarkerService");
const lhkSvc = require("../../services/ppic/lhkMarkerFormService");

const getBrowse = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const today = new Date().toISOString().substring(0, 10);
    const data = await svc.getBrowse({
      startDate: startDate || today,
      endDate: endDate || today,
      status: status || "",
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const today = new Date().toISOString().substring(0, 10);
    const data = await svc.getDetail({
      startDate: startDate || today,
      endDate: endDate || today,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    await svc.deleteData(req.params.nomor);
    res
      .status(200)
      .json({ success: true, message: "Permintaan Marker dihapus." });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

const getMenungguValidasi = async (req, res) => {
  try {
    const data = await svc.getMenungguValidasi({ kode: req.user?.kode });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const listTandaTerima = async (req, res) => {
  try {
    const data = await lhkSvc.listTandaTerimaByPermintaan(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

const validasiTandaTerima = async (req, res) => {
  try {
    if (!req.user?.kode) {
      return res
        .status(401)
        .json({ success: false, message: "User tidak dikenali." });
    }
    const data = await lhkSvc.validasiTandaTerima(req.params.ttNomor, {
      kode: req.user.kode,
    });
    res
      .status(200)
      .json({ success: true, message: "Tanda terima divalidasi.", data });
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  deleteData,
  getMenungguValidasi,
  listTandaTerima,
  validasiTandaTerima,
};
