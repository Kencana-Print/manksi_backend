const service = require("../../../services/laporan/spanduk/monitoringJahitService");

// Galat dari lhkCommon.galat(): notFound -> 404, forbidden -> 403, selain itu 400
const kirimError = (res, error, statusDefault = 400) => {
  const status = error.notFound ? 404 : error.forbidden ? 403 : statusDefault;
  res.status(status).json({
    success: false,
    message: error.message || "Terjadi kesalahan",
  });
};

const getMonitoringJahit = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, perusahaan } = req.query;
    const data = await service.getMonitoringJahit(
      tglAwal,
      tglAkhir,
      perusahaan,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getMonitoringJahit };
