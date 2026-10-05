const service = require("../../services/penjualan/permintaanDesainFormService");

const createPD = async (req, res) => {
  try {
    const data = await service.createPD(req.body, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { createPD };
