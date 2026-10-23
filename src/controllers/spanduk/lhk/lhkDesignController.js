const service = require("../../../services/spanduk/lhk/lhkDesignService");

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

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getBrowseLhkDesign(tglAwal, tglAkhir, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getDetailLhkDesign(tglAwal, tglAkhir, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getStatus = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getStatusLhkDesign(tglAwal, tglAkhir, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const remove = async (req, res) => {
  try {
    await service.deleteLhkDesign(req.params.nomor, req.user);
    res.status(200).json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getBrowse, getDetail, getStatus, remove };
