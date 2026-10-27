const service = require("../../../services/laporan/spanduk/pemakaianBahanService");

const kirimError = (res, error, statusDefault = 500) => {
  const status = error.notFound
    ? 404
    : error.forbidden
      ? 403
      : error.status || statusDefault;
  return res.status(status).json({ success: false, message: error.message });
};

const getPemakaianBahan = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getPemakaianBahan(tglAwal, tglAkhir);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getPemakaianBahan };
