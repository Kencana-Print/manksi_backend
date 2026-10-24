const service = require("../../services/spanduk/bastMapSpandukFormService");

const kirimError = (res, error) => {
  if (error.notFound) return res.status(404).json({ message: error.message });
  if (error.forbidden) return res.status(403).json({ message: error.message });
  if (error.code || error.sqlMessage) {
    console.error(error);
    return res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
  return res.status(400).json({ message: error.message });
};

const lookupMap = async (req, res) => {
  try {
    res.json({ data: await service.getLookupMap(req.query.search, req.user) });
  } catch (error) {
    kirimError(res, error);
  }
};

const lookupBahan = async (req, res) => {
  try {
    res.json({ data: await service.getLookupBahan(req.query.search) });
  } catch (error) {
    kirimError(res, error);
  }
};

const getById = async (req, res) => {
  try {
    res.json({ data: await service.getFormData(req.params.nomor, req.user) });
  } catch (error) {
    kirimError(res, error);
  }
};

const create = async (req, res) => {
  try {
    const nomor = await service.create(req.body, req.user);
    res.status(201).json({ message: "BAST MAP berhasil disimpan", nomor });
  } catch (error) {
    kirimError(res, error);
  }
};

const update = async (req, res) => {
  try {
    const nomor = await service.update(req.params.nomor, req.body, req.user);
    res.json({ message: "BAST MAP berhasil diperbarui", nomor });
  } catch (error) {
    kirimError(res, error);
  }
};

const getPrint = async (req, res) => {
  try {
    res.json({ data: await service.getPrintData(req.params.nomor, req.user) });
  } catch (error) {
    kirimError(res, error);
  }
};

const setKeputusan = async (req, res) => {
  try {
    const nomor = await service.setKeputusan(
      req.params.nomor,
      req.body,
      req.user,
    );
    res
      .status(200)
      .json({ success: true, message: "Keputusan disimpan", data: { nomor } });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = {
  lookupMap,
  lookupBahan,
  getById,
  getPrint,
  create,
  update,
  setKeputusan,
};
