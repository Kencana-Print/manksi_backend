const service = require("../../../services/laporan/spanduk/rekapMonitoringByGudangService");

const kirimError = (res, error, statusDefault = 500) => {
  const status = error.notFound
    ? 404
    : error.forbidden
      ? 403
      : error.status || statusDefault;
  return res.status(status).json({ success: false, message: error.message });
};

const getRekapMonitoringByGudang = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, jenis } = req.query;
    const data = await service.getRekapMonitoringByGudang(
      tglAwal,
      tglAkhir,
      jenis,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getRekapMonitoringByGudang };
