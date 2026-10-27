const service = require("../../../services/laporan/spanduk/resumeProofService");

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

const getResumeProof = async (req, res) => {
  try {
    const data = await service.getResumeProof(
      req.query.tglAwal,
      req.query.tglAkhir,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getResumeProof };
