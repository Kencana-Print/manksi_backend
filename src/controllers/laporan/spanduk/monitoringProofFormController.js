const service = require("../../../services/laporan/spanduk/monitoringProofFormService");

const kirimError = (res, error, statusDefault) => {
  if (error.notFound) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.forbidden) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res
    .status(statusDefault)
    .json({ success: false, message: error.message });
};

const getForm = async (req, res) => {
  try {
    const data = await service.getForm(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const simpan = async (req, res) => {
  try {
    const data = await service.simpan(req.params.nomor, req.body, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getGudangProof = async (req, res) => {
  try {
    const data = await service.getGudangProof();
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getDaftarMap = async (req, res) => {
  try {
    const data = await service.getDaftarMap(req.query.cari, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getForm, simpan, getGudangProof, getDaftarMap };
