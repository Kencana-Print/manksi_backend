const service = require("../../../services/laporan/spanduk/ketercapaianKomitmenKirimService");

const kirimError = (res, error, statusDefault = 500) => {
  const status = error.notFound
    ? 404
    : error.forbidden
      ? 403
      : error.status || statusDefault;
  return res.status(status).json({ success: false, message: error.message });
};

const getKetercapaian = async (req, res) => {
  try {
    const { tglAwal, tglAkhir, cabang } = req.query;
    const data = await service.getKetercapaian(tglAwal, tglAkhir, cabang);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getKetercapaian };
