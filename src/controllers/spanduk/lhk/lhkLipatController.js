const service = require("../../../services/spanduk/lhk/lhkLipatService");

const kirimError = (res, e) => {
  if (e.notFound) {
    return res.status(404).json({ success: false, message: e.message });
  }
  if (e.forbidden) {
    return res.status(403).json({ success: false, message: e.message });
  }
  // Error database: jangan bocorkan detail SQL ke klien
  if (e.sqlMessage || e.errno) {
    console.error("[lhk-lipat]", e);
    return res
      .status(500)
      .json({ success: false, message: "Terjadi kesalahan pada server" });
  }
  return res.status(400).json({ success: false, message: e.message });
};

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getBrowseLhkLipat(tglAwal, tglAkhir, req.user);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const getDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getDetailLhkLipat(tglAwal, tglAkhir, req.user);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const hapus = async (req, res) => {
  try {
    await service.deleteLhkLipat(req.params.nomor, req.user);
    res.json({ success: true, message: "LHK Lipat berhasil dihapus" });
  } catch (e) {
    kirimError(res, e);
  }
};

module.exports = { getBrowse, getDetail, hapus };
