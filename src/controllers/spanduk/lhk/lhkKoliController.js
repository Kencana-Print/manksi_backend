const service = require("../../../services/spanduk/lhk/lhkKoliService");

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
    const data = await service.getBrowseLhkKoli(
      req.query.tglAwal,
      req.query.tglAkhir,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetailLhkKoli(
      req.query.tglAwal,
      req.query.tglAkhir,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 500);
  }
};

const hapus = async (req, res) => {
  try {
    await service.deleteLhkKoli(req.params.nomor, req.user);
    res.status(200).json({ success: true, message: "Berhasil dihapus" });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getBrowse, getDetail, hapus };
