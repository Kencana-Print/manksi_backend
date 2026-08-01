const svc = require("../../services/tools/relationshipMapService");

const getExpand = async (req, res) => {
  try {
    const { type, nomor } = req.query;
    if (!type || !nomor) {
      return res
        .status(400)
        .json({ success: false, message: "type dan nomor wajib diisi." });
    }
    const data = await svc.expand(type.toUpperCase(), nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getSearch = async (req, res) => {
  try {
    const { type, q } = req.query;
    const data = await svc.search(type ? type.toUpperCase() : null, q);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getExpand, getSearch };
