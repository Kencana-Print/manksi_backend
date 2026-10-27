const service = require("../../../services/laporan/spanduk/monitoringCetakService");

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

const getMonitoringCetak = async (req, res) => {
  try {
    const data = await service.getMonitoringCetak(
      req.query.tglAwal,
      req.query.tglAkhir,
      req.query.perusahaan,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getMonitoringCetak };
