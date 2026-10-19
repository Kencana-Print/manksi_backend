const service = require("../../services/spanduk/bastMapSpandukService");

const kirimError = (res, error) => {
  if (error.notFound) return res.status(404).json({ message: error.message });
  if (error.forbidden) return res.status(403).json({ message: error.message });
  if (error.code || error.sqlMessage) {
    console.error(error);
    return res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
  return res.status(400).json({ message: error.message });
};

const getBrowse = async (req, res) => {
  try {
    const data = await service.getBrowseList(req.query, req.user);
    res.json({ data });
  } catch (error) {
    kirimError(res, error);
  }
};

const remove = async (req, res) => {
  try {
    await service.deleteBast(req.params.nomor, req.user);
    res.json({ message: "BAST berhasil dihapus" });
  } catch (error) {
    kirimError(res, error);
  }
};

module.exports = { getBrowse, remove };
