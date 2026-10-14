const service = require("../../../services/spanduk/lhk/lhkPlotterFormService");

const kirimError = (res, error) => {
  if (error.notFound) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.forbidden) {
    return res.status(403).json({ success: false, message: error.message });
  }
  // Error validasi/bisnis dari service tidak diberi flag -> 400
  // Error DB/sistem punya properti code (mis. ER_*) -> 500
  const status = error.code || error.sqlMessage ? 500 : 400;
  return res.status(status).json({ success: false, message: error.message });
};

const getById = async (req, res) => {
  try {
    const data = await service.getLhkPlotterById(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getInfoSpk = async (req, res) => {
  try {
    const data = await service.getInfoSpk(req.params.nomor, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const getLookupPabrik = async (req, res) => {
  try {
    const data = await service.getLookupPabrik(req.query.search);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error);
  }
};

const create = async (req, res) => {
  try {
    const nomor = await service.createLhkPlotter(req.body, req.user);
    res.status(201).json({
      success: true,
      message: `Tersimpan dengan nomor: ${nomor}`,
      data: { Nomor: nomor },
    });
  } catch (error) {
    kirimError(res, error);
  }
};

const update = async (req, res) => {
  try {
    const nomor = await service.updateLhkPlotter(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.status(200).json({
      success: true,
      message: "Perubahan berhasil disimpan",
      data: { Nomor: nomor },
    });
  } catch (error) {
    kirimError(res, error);
  }
};

module.exports = { getById, getInfoSpk, getLookupPabrik, create, update };
