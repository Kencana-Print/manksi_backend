const service = require("../../services/penjualan/permintaanDesainFormService");

const createPD = async (req, res) => {
  try {
    const bagian = String(req.user?.bagian || "")
      .toUpperCase()
      .trim();
    if (bagian === "DESAIN") {
      return res.status(403).json({
        success: false,
        message: "Bagian Desain tidak dapat membuat permintaan desain",
      });
    }
    const data = await service.createPD(req.body, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { createPD };
