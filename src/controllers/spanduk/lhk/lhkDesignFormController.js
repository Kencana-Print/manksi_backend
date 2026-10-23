const service = require("../../../services/spanduk/lhk/lhkDesignFormService");

// notFound -> 404, forbidden -> 403, selain itu statusDefault
const kirimError = (res, error, statusDefault = 400) => {
  const status = error.notFound ? 404 : error.forbidden ? 403 : statusDefault;
  res.status(status).json({ success: false, message: error.message });
};

const lookupSpk = async (req, res) => {
  try {
    const data = await service.getLookupSpk(req.query.search, req.user);
    res.json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const lookupDesigner = async (req, res) => {
  try {
    res.json({ success: true, data: await service.getLookupDesigner() });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const lookupMesin = async (req, res) => {
  try {
    res.json({ success: true, data: await service.getLookupMesin() });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const lookupBahan = (req, res) => {
  res.json({ success: true, data: service.getLookupBahan() });
};

const getById = async (req, res) => {
  try {
    const data = await service.getLhkDesignById(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const simpan = async (req, res) => {
  try {
    const data = await service.simpanLhkDesign(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.json({ success: true, data, message: "Berhasil disimpan" });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const mulai = async (req, res) => {
  try {
    const data = await service.mulaiLhkDesign(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.json({ success: true, data, message: "Pekerjaan dimulai" });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const selesai = async (req, res) => {
  try {
    const data = await service.selesaiLhkDesign(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.json({ success: true, data, message: "Pekerjaan selesai" });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = {
  lookupSpk,
  lookupDesigner,
  lookupMesin,
  lookupBahan,
  getById,
  simpan,
  mulai,
  selesai,
};
