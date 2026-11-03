const svc = require("../../services/garmen/permintaanMarkerFormService");

const kirimError = (res, error) =>
  res
    .status(error.statusCode || 500)
    .json({ success: false, message: error.message });

const getDetail = async (req, res) => {
  try {
    const data = await svc.getDetail(req.params.nomor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const create = async (req, res) => {
  try {
    const data = await svc.saveData(req.body, req.user);
    res.status(201).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const update = async (req, res) => {
  try {
    const data = await svc.saveData(
      { ...req.body, nomor: req.params.nomor },
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const setStatus = async (req, res) => {
  try {
    const data = await svc.setStatus(req.params.nomor, req.body, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getBahanMkb = async (req, res) => {
  try {
    const data = await svc.getBahanMkb(req.query.spk);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getBahanInfo = async (req, res) => {
  try {
    const data = await svc.getBahanInfo(req.params.kode, req.query.spk);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getSettings = async (req, res) => {
  try {
    const data = await svc.getSettings();
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const jalankan = (fn) => async (req, res) => {
  try {
    const data = await fn(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const closePermintaan = jalankan((nomor, user) =>
  svc.closePermintaan(nomor, user),
);

module.exports = {
  getDetail,
  create,
  update,
  setStatus,
  getBahanMkb,
  getBahanInfo,
  getSettings,
  closePermintaan,
};
