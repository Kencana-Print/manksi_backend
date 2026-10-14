const service = require("../../services/spanduk/mutasiProduksiSpandukService");
const { kirimError } = require("./mutasiProduksiSpandukError");

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getBrowseMutasiProduksiSpanduk(
      tglAwal,
      tglAkhir,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await service.getDetailMutasiProduksiSpanduk(
      req.params.nomor,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const hapus = async (req, res) => {
  try {
    await service.deleteMutasiProduksiSpanduk(req.params.nomor, req.user);
    res.json({ success: true, message: "Mutasi produksi berhasil dihapus" });
  } catch (e) {
    kirimError(res, e);
  }
};

module.exports = { getBrowse, getDetail, hapus };
