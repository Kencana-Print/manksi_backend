const service = require("../../../services/laporan/spanduk/monitoringLipatService");

const kirimError = (res, error, statusDefault = 400) => {
  const status = error.notFound ? 404 : error.forbidden ? 403 : statusDefault;
  return res.status(status).json({ success: false, message: error.message });
};

const getMonitoringLipat = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, perusahaan } = req.query;
    const data = await service.getMonitoringLipat(
      tglAwal,
      tglAkhir,
      perusahaan,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    return kirimError(res, error, 400);
  }
};

module.exports = { getMonitoringLipat };
