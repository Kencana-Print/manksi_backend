const service = require("../../../services/spanduk/lhk/lhkTintaFormService");

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

const getById = async (req, res) => {
  try {
    const data = await service.getLhkTintaById(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getInfoSpk = async (req, res) => {
  try {
    const data = await service.getInfoSpk(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getLookupPabrik = async (req, res) => {
  try {
    const data = await service.getLookupPabrik(req.query.search, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getLookupBahan = async (req, res) => {
  try {
    const data = await service.getLookupBahan(req.query.search);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const create = async (req, res) => {
  try {
    const nomor = await service.createLhkTinta(req.body, req.user);
    res.status(201).json({
      success: true,
      message: "Berhasil disimpan",
      data: { Nomor: nomor },
    });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const update = async (req, res) => {
  try {
    const nomor = await service.updateLhkTinta(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.status(200).json({
      success: true,
      message: "Berhasil disimpan",
      data: { Nomor: nomor },
    });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = {
  getById,
  getInfoSpk,
  getLookupPabrik,
  getLookupBahan,
  create,
  update,
};
