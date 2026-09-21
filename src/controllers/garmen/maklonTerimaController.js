// controllers/garmen/maklonTerimaController.js
const service = require("../../services/garmen/maklonTerimaService");

const getOutstandingByMkl = async (req, res) => {
  try {
    const [header, items] = await Promise.all([
      service.getMklHeader(req.params.mklNomor),
      service.getOutstandingByMkl(req.params.mklNomor),
    ]);
    res.status(200).json({ success: true, data: { header, items } });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.saveValidasi(req.body, req.user);
    res
      .status(200)
      .json({
        success: true,
        message: "Terima Hasil Maklon berhasil disimpan.",
        data: result,
      });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getOutstandingByMkl, save };
