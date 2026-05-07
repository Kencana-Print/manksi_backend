const formService = require("../../services/garmen/mintaBarangFormService");

const validateSpk = async (req, res) => {
  try {
    // Tambahkan req.user.cabang dan req.user.kode sebagai argumen ke-2 dan ke-3
    const data = await formService.validateSpkAndMka(
      req.params.spk,
      req.user.cabang,
      req.user.kode,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDetail = async (req, res) => {
  try {
    const data = await formService.getDetailForm(
      req.params.nomor,
      req.user.cabang,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const save = async (req, res) => {
  try {
    if (!req.body.details || req.body.details.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Detail barang tidak boleh kosong." });
    }
    const result = await formService.saveData(req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Data berhasil disimpan.",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { validateSpk, getDetail, save };
