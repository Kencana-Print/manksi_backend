const service = require("../../services/penjualan/permintaanDesainService");

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowse(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetail(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateProgress = async (req, res) => {
  try {
    const data = await service.updateProgress(
      req.params.nomor,
      req.body.jmlJadi,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const updateDesainer = async (req, res) => {
  try {
    const data = await service.updateDesainer(
      req.params.nomor,
      req.body.desainerKode,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const setStatusManual = async (req, res) => {
  try {
    const data = await service.setStatusManual(req.params.nomor, {
      status: req.body.status,
      keterangan: req.body.keterangan,
      referensi: req.body.referensi,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const resumeStatus = async (req, res) => {
  try {
    const data = await service.resumeStatus(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const searchReferensi = async (req, res) => {
  try {
    const data = await service.searchReferensi(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDesainerOptions = async (req, res) => {
  try {
    const data = await service.getDesainerOptions();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBrowse,
  getDetail,
  updateProgress,
  updateDesainer,
  setStatusManual,
  resumeStatus,
  searchReferensi,
  getDesainerOptions,
};
