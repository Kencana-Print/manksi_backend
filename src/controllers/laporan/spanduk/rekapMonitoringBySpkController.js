const service = require("../../../services/laporan/spanduk/rekapMonitoringBySpkService");

const kirimError = (res, error, statusDefault = 500) => {
  const status = error.notFound
    ? 404
    : error.forbidden
      ? 403
      : error.status || statusDefault;
  return res.status(status).json({ success: false, message: error.message });
};

const getRekapMonitoringBySpk = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, perusahaan } = req.query;
    const data = await service.getRekapMonitoringBySpk(
      tglAwal,
      tglAkhir,
      perusahaan,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getRekapMonitoringBySpk };
