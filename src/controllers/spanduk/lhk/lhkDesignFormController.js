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

const simpanBatch = async (req, res) => {
  try {
    const data = await service.simpanLhkDesignBatch(req.body, req.user);
    res.json({ success: true, data, message: "Berhasil disimpan" });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const sesiAktif = async (req, res) => {
  try {
    res.json({ success: true, data: await service.getSesiAktif(req.user) });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const getSesi = async (req, res) => {
  try {
    const data = await service.getSesi(req.params.id, req.user);
    res.json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const sesiAksi = (fn, pesan) => async (req, res) => {
  try {
    const data = await fn(req);
    res.json({ success: true, data, message: pesan });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const mulaiSesi = sesiAksi(
  (req) => service.mulaiSesi(req.body, req.user),
  "Timer dimulai",
);
const pauseSesi = sesiAksi(
  (req) => service.pauseSesi(req.params.id, req.body, req.user),
  "Timer di-pause",
);
const resumeSesi = sesiAksi(
  (req) => service.resumeSesi(req.params.id, req.user),
  "Timer dilanjutkan",
);
const selesaiSesi = sesiAksi(
  (req) => service.selesaiSesi(req.params.id, req.body, req.user),
  "Pekerjaan selesai",
);
const batalSesi = sesiAksi(
  (req) => service.batalSesi(req.params.id, req.user),
  "Timer dibatalkan",
);

module.exports = {
  lookupSpk,
  lookupDesigner,
  lookupMesin,
  lookupBahan,
  getById,
  simpan,
  simpanBatch,
  sesiAktif,
  getSesi,
  mulaiSesi,
  pauseSesi,
  resumeSesi,
  selesaiSesi,
  batalSesi,
};
