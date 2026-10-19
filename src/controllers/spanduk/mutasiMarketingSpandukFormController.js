const service = require("../../services/spanduk/mutasiMarketingSpandukFormService");

const kirimError = (res, error, statusDefault) => {
  if (error.notFound) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.forbidden) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res
    .status(error.code || error.sqlMessage ? 500 : statusDefault)
    .json({ success: false, message: error.message });
};

const lookupMap = async (req, res) => {
  try {
    const data = await service.getLookupMap(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getById = async (req, res) => {
  try {
    const data = await service.getFormData(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const create = async (req, res) => {
  try {
    const data = await service.create(req.body, req.user);
    res.status(201).json({
      success: true,
      message: "Mutasi Marketing berhasil disimpan",
      data,
    });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const update = async (req, res) => {
  try {
    const data = await service.update(req.params.nomor, req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Mutasi Marketing berhasil diubah",
      data,
    });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getPrint = async (req, res) => {
  try {
    const data = await service.getPrintData(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { lookupMap, getById, getPrint, create, update };
