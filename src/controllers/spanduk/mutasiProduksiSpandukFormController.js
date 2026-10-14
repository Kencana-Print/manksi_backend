const service = require("../../services/spanduk/mutasiProduksiSpandukFormService");
const { kirimError } = require("./mutasiProduksiSpandukError");

const lookupLiniAsal = (req, res) => {
  try {
    res.json({ success: true, data: service.getLookupLiniAsal() });
  } catch (e) {
    kirimError(res, e);
  }
};

const lookupLiniTujuan = (req, res) => {
  try {
    const data = service.getLookupLiniTujuan(req.query.lini, req.query.jenis);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const lookupPabrik = async (req, res) => {
  try {
    const data = await service.getLookupPabrik(req.query.search, req.user);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const lookupLhk = async (req, res) => {
  try {
    const data = await service.getLookupLhk(
      req.query.lini,
      req.query.search,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const lookupSpkDiLhk = async (req, res) => {
  try {
    const data = await service.getLookupSpkDiLhk(
      req.query.lini,
      req.query.lhk,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const lookupHasilLhk = async (req, res) => {
  try {
    const data = await service.getLookupHasilLhk(
      req.query.lini,
      req.query.lhk,
      req.query.spk,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const getById = async (req, res) => {
  try {
    const data = await service.getMutasiProduksiSpandukById(
      req.params.nomor,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const create = async (req, res) => {
  try {
    const nomor = await service.createMutasiProduksiSpanduk(req.body, req.user);
    res.status(201).json({ success: true, data: { Nomor: nomor } });
  } catch (e) {
    kirimError(res, e);
  }
};

const update = async (req, res) => {
  try {
    const nomor = await service.updateMutasiProduksiSpanduk(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.json({ success: true, data: { Nomor: nomor } });
  } catch (e) {
    kirimError(res, e);
  }
};

module.exports = {
  lookupLiniAsal,
  lookupLiniTujuan,
  lookupPabrik,
  lookupLhk,
  lookupSpkDiLhk,
  lookupHasilLhk,
  getById,
  create,
  update,
};
