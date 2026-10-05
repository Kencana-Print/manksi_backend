const service = require("../../services/penjualan/permintaanDesainLampiranService");

const addLampiran = async (req, res) => {
  try {
    const data = await service.addLampiran(
      req.params.nomor,
      req.files,
      req.user.kode,
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getLampiran = async (req, res) => {
  try {
    const data = await service.getLampiran(req.params.nomor);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteLampiran = async (req, res) => {
  try {
    const data = await service.deleteLampiran(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { addLampiran, getLampiran, deleteLampiran };
