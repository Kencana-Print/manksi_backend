const service = require("../../services/penjualan/terimaMutasiDariProduksiService");

const kirimError = (res, error, statusDefault) => {
  if (error.notFound) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.forbidden) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res
    .status(error.code || error.sqlMessage ? 500 : statusDefault)
    .json({ success: false, message: error.message });
};

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getBrowse(tglAwal, tglAkhir, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const getDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getDetail(tglAwal, tglAkhir, req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const terima = async (req, res) => {
  try {
    const data = await service.terima(req.body, req.user);
    res.status(201).json({
      success: true,
      message: "Terima Mutasi berhasil disimpan",
      data,
    });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

const remove = async (req, res) => {
  try {
    await service.remove(req.params.nomor, req.user);
    res
      .status(200)
      .json({ success: true, message: "Terima Mutasi berhasil dibatalkan" });
  } catch (error) {
    kirimError(res, error, 400);
  }
};

module.exports = { getBrowse, getDetail, terima, remove };
