const service = require("../../../services/laporan/spanduk/monitoringHasilProofService");

const kirimError = (res, error, statusDefault = 400) => {
  const status = error.notFound ? 404 : error.forbidden ? 403 : statusDefault;
  return res.status(status).json({ success: false, message: error.message });
};

const getMonitoringHasilProof = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getMonitoringHasilProof(tglAwal, tglAkhir);
    res.status(200).json({ success: true, data });
  } catch (error) {
    return kirimError(res, error, 400);
  }
};

module.exports = { getMonitoringHasilProof };
