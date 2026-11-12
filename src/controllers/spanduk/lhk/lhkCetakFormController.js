const service = require("../../../services/spanduk/lhk/lhkCetakFormService");

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
    const data = await service.getLhkCetakById(req.params.nomor, req.user);
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

const getLookupKain = async (req, res) => {
  try {
    const data = await service.getLookupKain(req.query.search);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getLookupKaryawan = async (req, res) => {
  try {
    const data = await service.getLookupKaryawan(
      req.query.pabrik,
      req.query.sesi,
      req.query.tanggal,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const create = async (req, res) => {
  try {
    const hasil = await service.createLhkCetak(req.body, req.user);
    res.status(201).json({
      success: true,
      message: hasil.menungguApproval
        ? "Berhasil disimpan. LHK menunggu approval SPV/Manager karena pemakaian kain melebihi kebutuhan"
        : "Berhasil disimpan",
      data: { Nomor: hasil.nomor, Menunggu_Approval: hasil.menungguApproval },
    });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const update = async (req, res) => {
  try {
    const hasil = await service.updateLhkCetak(
      req.params.nomor,
      req.body,
      req.user,
    );
    res.status(200).json({
      success: true,
      message: hasil.menungguApproval
        ? "Berhasil disimpan. LHK menunggu approval SPV/Manager karena pemakaian kain melebihi kebutuhan"
        : "Berhasil disimpan",
      data: { Nomor: hasil.nomor, Menunggu_Approval: hasil.menungguApproval },
    });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = {
  getById,
  getInfoSpk,
  getLookupPabrik,
  getLookupKain,
  getLookupKaryawan,
  create,
  update,
};
