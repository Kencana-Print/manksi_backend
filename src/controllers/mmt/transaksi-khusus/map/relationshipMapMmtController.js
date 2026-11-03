const svc = require("../../../../services/mmt/transaksi-khusus/map/relationshipMapMmtService");

const search = async (req, res, next) => {
  try {
    const data = await svc.search(req.query.type || "", req.query.q || "");
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const expand = async (req, res, next) => {
  try {
    const { type, nomor } = req.query;
    if (!type || !nomor) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter type & nomor wajib diisi." });
    }
    const data = await svc.expand(type, nomor);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Dokumen tidak ditemukan." });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = { search, expand };
