const service = require("../../../services/spanduk/lhk/lhkJahitService");

const kirimError = (res, e) => {
  if (e.notFound) {
    return res.status(404).json({ success: false, message: e.message });
  }
  if (e.forbidden) {
    return res.status(403).json({ success: false, message: e.message });
  }
  // Error database: jangan bocorkan detail SQL ke klien
  if (e.sqlMessage || e.errno) {
    console.error("[lhk-jahit]", e);
    return res
      .status(500)
      .json({ success: false, message: "Terjadi kesalahan pada server" });
  }
  return res.status(400).json({ success: false, message: e.message });
};

const getBrowse = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getBrowseLhkJahit(tglAwal, tglAkhir, req.user);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const getDetail = async (req, res) => {
  try {
    const { tglAwal, tglAkhir } = req.query;
    const data = await service.getDetailLhkJahit(tglAwal, tglAkhir, req.user);
    res.json({ success: true, data });
  } catch (e) {
    kirimError(res, e);
  }
};

const getKaryawan = async (req, res) => {
  try {
    const data = await service.getKaryawanLhkJahit(
      req.query.tglAwal,
      req.query.tglAkhir,
      req.user,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    kirimError(res, error, 400);
  }
};
const hapus = async (req, res) => {
  try {
    await service.deleteLhkJahit(req.params.nomor, req.user);
    res.json({ success: true, message: "LHK Jahit berhasil dihapus" });
  } catch (e) {
    kirimError(res, e);
  }
};

module.exports = { getBrowse, getDetail, getKaryawan, hapus };
