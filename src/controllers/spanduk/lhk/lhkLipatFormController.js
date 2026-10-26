const service = require("../../../services/spanduk/lhk/lhkLipatFormService");

const kirimError = (res, e) => {
  if (e.notFound) {
    return res.status(404).json({ success: false, message: e.message });
  }
  if (e.forbidden) {
    return res.status(403).json({ success: false, message: e.message });
  }
  // Error database: jangan bocorkan detail SQL ke klien
  if (e.sqlMessage || e.errno) {
    console.error("[lhk-lipat-form]", e);
    return res
      .status(500)
      .json({ success: false, message: "Terjadi kesalahan pada server" });
  }
  return res.status(400).json({ success: false, message: e.message });
};

const lookupPabrik = async (req, res) => {
  try {
    const data = await service.getLookupPabrik(req.query.search);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const lookupKaryawan = async (req, res) => {
  try {
    const data = await service.getLookupKaryawan(
      req.query.pabrik,
      req.query.sesi,
      req.query.tanggal,
    );
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const infoSpk = async (req, res) => {
  try {
    const data = await service.getInfoSpk(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const getById = async (req, res) => {
  try {
    const data = await service.getLhkLipatById(req.params.nomor, req.user);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const create = async (req, res) => {
  try {
    const nomor = await service.createLhkLipat(req.body, req.user);
    res.status(201).json({
      success: true,
      message: "LHK Lipat berhasil disimpan",
      data: { Nomor: nomor },
    });
  } catch (e) {
    kirimError(res, e);
  }
};

const update = async (req, res) => {
  try {
    const nomor = await service.updateLhkLipat(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.json({
      success: true,
      message: "LHK Lipat berhasil diubah",
      data: { Nomor: nomor },
    });
  } catch (e) {
    kirimError(res, e);
  }
};

module.exports = {
  lookupPabrik,
  lookupKaryawan,
  infoSpk,
  getById,
  create,
  update,
};
