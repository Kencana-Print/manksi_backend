const svc = require("../../services/tools/relationshipMapService");

const kirimError = (res, err, statusDefault) =>
  res
    .status(err.forbidden ? 403 : statusDefault)
    .json({ success: false, message: err.message });

const getExpand = async (req, res) => {
  try {
    const { type, nomor } = req.query;
    if (!type || !nomor) {
      return res
        .status(400)
        .json({ success: false, message: "type dan nomor wajib diisi." });
    }
    const data = await svc.expand(type.toUpperCase(), nomor, req.user.kode);
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err, 400);
  }
};

const getSearch = async (req, res) => {
  try {
    const { type, q } = req.query;
    const data = await svc.search(
      type ? type.toUpperCase() : null,
      q,
      req.user.kode,
    );
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err, 500);
  }
};

const getTypes = async (req, res) => {
  try {
    const data = [...(await svc.getTipeBoleh(req.user.kode))];
    res.json({ success: true, data });
  } catch (err) {
    kirimError(res, err, 500);
  }
};

module.exports = { getExpand, getSearch, getTypes };
